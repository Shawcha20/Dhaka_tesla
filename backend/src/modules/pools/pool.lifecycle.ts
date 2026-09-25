import type { PoolStatus, RideStatus } from '../../domain/status.js';
import { assertPoolTransition, assertRideTransition, requeueStatusFor } from '../../domain/transitions.js';
import { AppError } from '../../lib/errors.js';
import { recordTransition, type DbWriter } from '../../lib/history.js';
import { prisma } from '../../lib/prisma.js';
import { lockPoolFares } from './pool.fares.js';
import { createPendingPayments, settlePoolPayments, type SettlementLine } from './pool.payments.js';
import { getPoolForDriver } from './pool.service.js';

/**
 * The driver's trip controls: arrive, start, complete, cancel.
 *
 * Each one advances the pool and fans the same step out to every active member,
 * inside one transaction. The two machines stay in step because a member can only
 * move to the status the pool just reached, and the transition table refuses
 * anything else.
 */

interface PoolRow {
  id: bigint;
  status: PoolStatus;
  members: { id: bigint; seats: number; rideRequestId: bigint; rideStatus: RideStatus }[];
}

/** Loads a pool the driver owns, with its active membership. */
async function loadOwnedPool(
  db: DbWriter,
  poolId: bigint,
  driverId: bigint,
): Promise<PoolRow> {
  const pool = await db.pool.findFirst({
    // Ownership in the WHERE: another driver's pool reads as absent, so the API
    // never confirms that someone else's pool id exists.
    where: { id: poolId, driverId },
    select: {
      id: true,
      status: true,
      members: {
        where: { leftAt: null },
        select: {
          id: true,
          seats: true,
          rideRequestId: true,
          rideRequest: { select: { status: true } },
        },
      },
    },
  });

  if (!pool) {
    throw new AppError('POOL_NOT_FOUND');
  }

  return {
    id: pool.id,
    status: pool.status,
    members: pool.members.map((m) => ({
      id: m.id,
      seats: m.seats,
      rideRequestId: m.rideRequestId,
      rideStatus: m.rideRequest.status,
    })),
  };
}

/**
 * Advances the pool and every active member to the matching status.
 *
 * `assertRideTransition` runs per member rather than once for the pool, because a
 * member could legitimately be out of step — cancelled a moment ago, for instance.
 * The state machine decides; this function only applies.
 */
async function advanceMembers(
  db: DbWriter,
  pool: PoolRow,
  to: Extract<RideStatus, 'DRIVER_ARRIVED' | 'STARTED' | 'COMPLETED'>,
  driverId: bigint,
  timestampField: 'arrivedAt' | 'startedAt' | 'completedAt',
): Promise<void> {
  const now = new Date();

  for (const member of pool.members) {
    assertRideTransition(member.rideStatus, to, 'DRIVER');

    await db.rideRequest.update({
      where: { id: member.rideRequestId },
      data: { status: to, [timestampField]: now },
    });

    await recordTransition(db, {
      rideRequestId: member.rideRequestId,
      fromStatus: member.rideStatus,
      toStatus: to,
      actorUserId: driverId,
      actorRole: 'DRIVER',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMING → DRIVER_ARRIVED
// ─────────────────────────────────────────────────────────────────────────────

export async function markArrived(driverId: bigint, poolId: bigint) {
  await prisma.$transaction(async (tx) => {
    const pool = await loadOwnedPool(tx, poolId, driverId);
    assertPoolTransition(pool.status, 'DRIVER_ARRIVED', 'DRIVER');

    const now = new Date();
    await tx.pool.update({
      where: { id: pool.id },
      // The pool stops accepting members here: FORMING is the only status that
      // takes new passengers, so leaving it closes the door.
      data: { status: 'DRIVER_ARRIVED', arrivedAt: now },
    });

    await advanceMembers(tx, pool, 'DRIVER_ARRIVED', driverId, 'arrivedAt');

    await recordTransition(tx, {
      poolId: pool.id,
      fromStatus: pool.status,
      toStatus: 'DRIVER_ARRIVED',
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note: 'Driver reached the pickup area',
    });
  });

  return getPoolForDriver(poolId, driverId);
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER_ARRIVED → STARTED — where the money becomes final
// ─────────────────────────────────────────────────────────────────────────────

export async function startTrip(driverId: bigint, poolId: bigint) {
  await prisma.$transaction(async (tx) => {
    const pool = await loadOwnedPool(tx, poolId, driverId);
    assertPoolTransition(pool.status, 'STARTED', 'DRIVER');

    if (pool.members.length === 0) {
      // Everybody cancelled before departure. There is nobody to drive.
      throw new AppError('POOL_EMPTY');
    }

    const now = new Date();
    await tx.pool.update({
      where: { id: pool.id },
      data: { status: 'STARTED', startedAt: now },
    });

    await advanceMembers(tx, pool, 'STARTED', driverId, 'startedAt');

    /**
     * Fares lock here, and payments are raised against the locked figures.
     *
     * Before this point a price is an estimate that membership changes can move;
     * after it, `final_fare_paisa` is a fact. A passenger in the vehicle cannot
     * have their price change under them.
     */
    await lockPoolFares(tx, pool.id);
    await createPendingPayments(tx, pool.id);

    await recordTransition(tx, {
      poolId: pool.id,
      fromStatus: pool.status,
      toStatus: 'STARTED',
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note: `Trip started with ${pool.members.length} passenger(s); fares locked`,
    });
  });

  return getPoolForDriver(poolId, driverId);
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTED → COMPLETED
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionResult {
  pool: Awaited<ReturnType<typeof getPoolForDriver>>;
  settlement: SettlementLine[];
}

export async function completeTrip(
  driverId: bigint,
  poolId: bigint,
): Promise<CompletionResult> {
  const settlement = await prisma.$transaction(async (tx) => {
    const pool = await loadOwnedPool(tx, poolId, driverId);
    assertPoolTransition(pool.status, 'COMPLETED', 'DRIVER');

    const now = new Date();
    await tx.pool.update({
      where: { id: pool.id },
      data: { status: 'COMPLETED', completedAt: now },
    });

    await advanceMembers(tx, pool, 'COMPLETED', driverId, 'completedAt');

    // A wallet shortfall marks that payment FAILED rather than aborting: the
    // passengers have already been delivered.
    const lines = await settlePoolPayments(tx, pool.id);

    const failed = lines.filter((line) => line.status === 'FAILED');
    await recordTransition(tx, {
      poolId: pool.id,
      fromStatus: pool.status,
      toStatus: 'COMPLETED',
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note:
        failed.length === 0
          ? `Trip completed; ${lines.length} payment(s) settled`
          : `Trip completed; ${failed.length} of ${lines.length} payment(s) failed — collect in cash`,
    });

    return lines;
  });

  return { pool: await getPoolForDriver(poolId, driverId), settlement };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel — members return to the queue rather than being marked cancelled
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelPool(
  driverId: bigint,
  poolId: bigint,
  reason: string | undefined,
) {
  await prisma.$transaction(async (tx) => {
    const pool = await loadOwnedPool(tx, poolId, driverId);
    assertPoolTransition(pool.status, 'CANCELLED', 'DRIVER');

    const now = new Date();

    for (const member of pool.members) {
      /**
       * The passengers did not give up, so marking them CANCELLED would be a lie.
       * They go back to REQUESTED and become matchable by another driver, with the
       * actor recorded as SYSTEM because neither party chose this.
       */
      const requeueTo = requeueStatusFor(member.rideStatus);
      if (requeueTo === null) {
        // Unreachable in practice: a pool cannot be cancelled from STARTED, so no
        // member can be past DRIVER_ARRIVED here. Guarded rather than assumed.
        throw new AppError('INVALID_STATE_TRANSITION', {
          message: `Cannot requeue a ride in ${member.rideStatus}.`,
        });
      }

      await tx.poolMember.update({ where: { id: member.id }, data: { leftAt: now } });

      await tx.rideRequest.update({
        where: { id: member.rideRequestId },
        data: {
          status: requeueTo,
          // Cleared so the requeued request looks untouched to the next driver.
          matchedAt: null,
          arrivedAt: null,
          // The solo estimate is still on the row and is what applies again now.
          finalFarePaisa: null,
        },
      });

      await recordTransition(tx, {
        rideRequestId: member.rideRequestId,
        fromStatus: member.rideStatus,
        toStatus: requeueTo,
        actorUserId: null,
        actorRole: 'SYSTEM',
        note: reason ? `Pool cancelled: ${reason}` : 'Pool cancelled by driver',
      });
    }

    await tx.pool.update({
      where: { id: pool.id },
      data: { status: 'CANCELLED', cancelledAt: now, seatsTaken: 0 },
    });

    await recordTransition(tx, {
      poolId: pool.id,
      fromStatus: pool.status,
      toStatus: 'CANCELLED',
      actorUserId: driverId,
      actorRole: 'DRIVER',
      ...(reason ? { note: reason } : {}),
    });
  });

  return getPoolForDriver(poolId, driverId);
}

// ─────────────────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────────────────

export async function listPoolsForDriver(
  driverId: bigint,
  filters: { limit: number; cursor?: number },
) {
  const pools = await prisma.pool.findMany({
    where: {
      driverId,
      ...(filters.cursor ? { id: { lt: BigInt(filters.cursor) } } : {}),
    },
    take: filters.limit + 1,
    orderBy: { id: 'desc' },
    select: {
      id: true,
      status: true,
      capacity: true,
      seatsTaken: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
      pickupArea: { select: { id: true, name: true } },
      vehicle: { select: { name: true, plateNo: true } },
      members: {
        select: {
          seats: true,
          farePaisa: true,
          leftAt: true,
          rideRequest: {
            select: {
              finalFarePaisa: true,
              dropoffArea: { select: { name: true } },
              passenger: { select: { name: true } },
              payment: { select: { status: true, method: true } },
            },
          },
        },
      },
    },
  });

  const page = pools.slice(0, filters.limit);
  const nextCursor = pools.length > filters.limit ? (page.at(-1)?.id.toString() ?? null) : null;

  return {
    data: page.map((pool) => {
      const active = pool.members.filter((m) => m.leftAt === null);
      // Earnings come from the locked figure once a trip has run; before that the
      // live member fare is the best available estimate.
      const earnedPaisa = active.reduce(
        (sum, m) => sum + (m.rideRequest.finalFarePaisa ?? m.farePaisa),
        0n,
      );
      const seatsUsed = active.reduce((sum, m) => sum + m.seats, 0);

      return {
        id: pool.id,
        status: pool.status,
        pickupArea: pool.pickupArea,
        vehicle: pool.vehicle,
        capacity: pool.capacity,
        seatsUsed,
        // The number that shows whether pooling is actually working.
        utilisationPct: Math.round((seatsUsed / pool.capacity) * 100),
        passengerCount: active.length,
        pooled: active.length > 1,
        earnedPaisa,
        passengers: active.map((m) => ({
          name: m.rideRequest.passenger.name.split(' ')[0] ?? m.rideRequest.passenger.name,
          dropoffArea: m.rideRequest.dropoffArea.name,
          seats: m.seats,
          farePaisa: m.rideRequest.finalFarePaisa ?? m.farePaisa,
          paymentStatus: m.rideRequest.payment?.status ?? null,
          paymentMethod: m.rideRequest.payment?.method ?? null,
        })),
        createdAt: pool.createdAt,
        startedAt: pool.startedAt,
        completedAt: pool.completedAt,
        cancelledAt: pool.cancelledAt,
      };
    }),
    meta: { nextCursor },
  };
}
