import { env } from '../../config/env.js';
import { evaluatePoolability, type PoolabilityReason } from '../../domain/matching.js';
import type { PoolEvent, PoolStatus } from '../../domain/status.js';
import { AppError } from '../../lib/errors.js';
import { initialBearingDeg } from '../../lib/geo.js';
import { recordTransition, type DbWriter } from '../../lib/history.js';
import { prisma } from '../../lib/prisma.js';
import { toCoordinates } from '../areas/areas.service.js';
import { recalculatePoolFares } from './pool.fares.js';

/** A pool in any of these states occupies the driver; they cannot start another. */
export const ACTIVE_POOL_STATUSES: PoolStatus[] = [
  'FORMING',
  'DRIVER_ARRIVED',
  'STARTED',
];

/**
 * Maps a matching refusal to the right HTTP answer.
 *
 * Capacity and status are conflicts with current state (409); an incompatible
 * route is a semantically invalid request (422) — the driver asked for something
 * that will never be allowed, not something that might work later.
 */
function matchingFailure(reason: PoolabilityReason, bearingDiffDeg: number | null): AppError {
  switch (reason) {
    case 'POOL_NOT_FORMING':
      return new AppError('POOL_NOT_FORMING');
    case 'NOT_ENOUGH_SEATS':
      return new AppError('POOL_CAPACITY_EXCEEDED');
    case 'DIFFERENT_PICKUP_AREA':
      return new AppError('ROUTE_NOT_COMPATIBLE', {
        message: 'That passenger is waiting in a different area.',
      });
    case 'ROUTE_NOT_COMPATIBLE':
      return new AppError('ROUTE_NOT_COMPATIBLE', {
        message:
          bearingDiffDeg === null
            ? 'Those routes are not heading the same way.'
            : `Those routes diverge by ${bearingDiffDeg}°, beyond the ${env.pooling.maxBearingDiffDeg}° limit.`,
        context: { bearingDiffDeg },
      });
  }
}

/**
 * Claims seats on a pool. **This is the concurrency-critical operation.**
 *
 * A single conditional UPDATE, and deliberately not a SELECT followed by an
 * UPDATE. The bug in the read-then-write version is the gap between them: with one
 * seat left, two requests both read `seats_taken = 2`, both compute 3, and both
 * write. Here there is no read to be stale — the WHERE clause is evaluated by
 * InnoDB against committed state at the moment of the write, so the second
 * attempt matches zero rows and learns it lost from the row count.
 *
 * It does a second job as well. InnoDB holds the exclusive row lock taken for this
 * write until the transaction commits, so any other join targeting the same pool
 * blocks here. That makes everything *after* this call in the same transaction
 * effectively serialised per pool — which is what lets the matching rule read a
 * stable member list a few lines later.
 *
 * Returns false rather than throwing so callers can attach their own message.
 */
export async function tryClaimSeats(
  db: DbWriter,
  poolId: bigint,
  seats: number,
): Promise<boolean> {
  const affected = await db.$executeRaw`
    UPDATE pools
       SET seats_taken = seats_taken + ${seats}
     WHERE id = ${poolId}
       AND status = 'FORMING'
       AND seats_taken + ${seats} <= capacity
  `;
  return affected === 1;
}

/** Returns a seat to the pool. Guarded so a double release cannot underflow. */
export async function releaseSeats(
  db: DbWriter,
  poolId: bigint,
  seats: number,
): Promise<boolean> {
  const affected = await db.$executeRaw`
    UPDATE pools
       SET seats_taken = seats_taken - ${seats}
     WHERE id = ${poolId}
       AND seats_taken >= ${seats}
  `;
  return affected === 1;
}

/**
 * Moves a ride from REQUESTED to MATCHED, atomically.
 *
 * The driver-side race: two drivers see the same open request and both accept it.
 * Resolved by the same mechanism as the seat claim — the status is part of the
 * WHERE clause, so exactly one UPDATE can match.
 */
async function tryClaimRide(db: DbWriter, rideRequestId: bigint): Promise<boolean> {
  const affected = await db.$executeRaw`
    UPDATE ride_requests
       SET status = 'MATCHED', matched_at = NOW(3)
     WHERE id = ${rideRequestId}
       AND status = 'REQUESTED'
  `;
  return affected === 1;
}

interface RideForMatching {
  id: bigint;
  seatsRequested: number;
  pickupAreaId: number;
  bearingDeg: number;
  passengerId: bigint;
}

/** Loads a request with the geometry the matching rule needs. */
async function loadRideForMatching(
  db: DbWriter,
  rideRequestId: bigint,
): Promise<RideForMatching> {
  const ride = await db.rideRequest.findUnique({
    where: { id: rideRequestId },
    select: {
      id: true,
      status: true,
      seatsRequested: true,
      pickupAreaId: true,
      passengerId: true,
      pickupArea: { select: { latitude: true, longitude: true } },
      dropoffArea: { select: { latitude: true, longitude: true } },
      // Only an active membership blocks a new one. A requeued request keeps its
      // rows from the cancelled pool, and those must not stop it being picked up.
      poolMembers: { where: { leftAt: null }, select: { id: true } },
    },
  });

  if (!ride) {
    throw new AppError('RIDE_NOT_FOUND');
  }
  if (ride.poolMembers.length > 0) {
    throw new AppError('RIDE_ALREADY_MATCHED', {
      message: 'That passenger is already in a pool.',
    });
  }
  if (ride.status !== 'REQUESTED') {
    throw new AppError('RIDE_ALREADY_MATCHED', {
      message: `That request is no longer open (${ride.status}).`,
    });
  }

  return {
    id: ride.id,
    seatsRequested: ride.seatsRequested,
    pickupAreaId: ride.pickupAreaId,
    passengerId: ride.passengerId,
    bearingDeg: initialBearingDeg(
      toCoordinates(ride.pickupArea as never),
      toCoordinates(ride.dropoffArea as never),
    ),
  };
}

/** The driver's vehicle, with the checks every accept path needs. */
async function loadOnlineVehicle(db: DbWriter, driverId: bigint) {
  const vehicle = await db.vehicle.findUnique({ where: { driverId } });

  if (!vehicle) {
    throw new AppError('VEHICLE_NOT_FOUND');
  }
  if (!vehicle.isOnline) {
    throw new AppError('VEHICLE_OFFLINE');
  }
  return vehicle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a pool around the first request
// ─────────────────────────────────────────────────────────────────────────────

export async function createPool(driverId: bigint, rideRequestId: bigint) {
  const poolId = await prisma.$transaction(async (tx) => {
    const vehicle = await loadOnlineVehicle(tx, driverId);

    /**
     * Locks the driver's own user row before checking for an existing pool.
     *
     * Same reasoning as ride creation: without it, two simultaneous accepts both
     * see "no active pool" and the driver ends up running two trips at once. The
     * narrowest lock that fixes it — different drivers never contend.
     */
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${driverId} FOR UPDATE`;

    const active = await tx.pool.count({
      where: { driverId, status: { in: ACTIVE_POOL_STATUSES } },
    });
    if (active > 0) {
      throw new AppError('DRIVER_HAS_ACTIVE_POOL');
    }

    const ride = await loadRideForMatching(tx, rideRequestId);

    if (ride.seatsRequested > vehicle.capacity) {
      throw new AppError('POOL_CAPACITY_EXCEEDED', {
        message: `${vehicle.name} seats ${vehicle.capacity}; that request needs ${ride.seatsRequested}.`,
      });
    }

    const pool = await tx.pool.create({
      data: {
        vehicleId: vehicle.id,
        driverId,
        pickupAreaId: ride.pickupAreaId,
        status: 'FORMING',
        // Snapshot, so a later change to the vehicle cannot rewrite what this
        // trip's capacity was.
        capacity: vehicle.capacity,
        seatsTaken: 0,
      },
    });

    // Goes through the same claim path as every later join, so the invariant has
    // one implementation rather than two.
    if (!(await tryClaimSeats(tx, pool.id, ride.seatsRequested))) {
      throw new AppError('POOL_CAPACITY_EXCEEDED');
    }

    if (!(await tryClaimRide(tx, ride.id))) {
      throw new AppError('RIDE_ALREADY_MATCHED', {
        message: 'Another driver accepted that request first.',
      });
    }

    await tx.poolMember.create({
      data: {
        poolId: pool.id,
        rideRequestId: ride.id,
        seats: ride.seatsRequested,
        // Solo for now: the discount only becomes real when someone else joins.
        farePaisa: 0n,
      },
    });
    await recalculatePoolFares(tx, pool.id, env.fare);

    await recordTransition(tx, {
      poolId: pool.id,
      fromStatus: null,
      toStatus: 'FORMING',
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note: `${vehicle.name} accepted the first passenger`,
    });
    await recordTransition(tx, {
      poolId: pool.id,
      toStatus: 'MEMBER_JOINED' satisfies PoolEvent,
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note: `Seats claimed (${ride.seatsRequested})`,
    });
    await recordTransition(tx, {
      rideRequestId: ride.id,
      fromStatus: 'REQUESTED',
      toStatus: 'MATCHED',
      actorUserId: driverId,
      actorRole: 'DRIVER',
    });

    return pool.id;
  });

  return getPoolForDriver(poolId, driverId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Add a passenger to an existing pool — the contested path
// ─────────────────────────────────────────────────────────────────────────────

export async function addMemberToPool(
  driverId: bigint,
  poolId: bigint,
  rideRequestId: bigint,
) {
  await prisma.$transaction(async (tx) => {
    await loadOnlineVehicle(tx, driverId);

    // Ownership as part of the lookup: another driver's pool reads as absent.
    const pool = await tx.pool.findFirst({
      where: { id: poolId, driverId },
      select: { id: true, status: true, capacity: true, seatsTaken: true, pickupAreaId: true },
    });
    if (!pool) {
      throw new AppError('POOL_NOT_FOUND');
    }

    const ride = await loadRideForMatching(tx, rideRequestId);

    /**
     * A pre-flight check purely for the error message.
     *
     * The authoritative decisions happen below, against locked state. This runs
     * first only so the driver gets a specific reason — "different area", "wrong
     * direction" — instead of a bare capacity failure.
     */
    const preflight = evaluatePoolability(
      {
        status: pool.status,
        pickupAreaId: pool.pickupAreaId,
        capacity: pool.capacity,
        seatsTaken: pool.seatsTaken,
        memberBearingsDeg: await activeMemberBearings(tx, pool.id),
      },
      {
        pickupAreaId: ride.pickupAreaId,
        seats: ride.seatsRequested,
        bearingDeg: ride.bearingDeg,
      },
      env.pooling,
    );
    if (!preflight.eligible && preflight.reason) {
      throw matchingFailure(preflight.reason, preflight.bearingDiffDeg);
    }

    /**
     * Claim the seats first.
     *
     * This both settles capacity atomically and takes the pool's row lock, which
     * is held until commit. Any concurrent join blocks here, so the member list
     * read on the next line cannot change underneath us.
     */
    if (!(await tryClaimSeats(tx, pool.id, ride.seatsRequested))) {
      throw new AppError('POOL_CAPACITY_EXCEEDED', {
        context: {
          poolId: pool.id.toString(),
          capacity: pool.capacity,
          requested: ride.seatsRequested,
        },
      });
    }

    /**
     * Re-validate the route against the now-stable member list.
     *
     * Necessary because the pre-flight check above ran before the lock: two
     * passengers each compatible with the pool as it stood may not be compatible
     * with each other. Throwing here rolls back the seat claim along with
     * everything else.
     */
    const confirmed = evaluatePoolability(
      {
        status: 'FORMING',
        pickupAreaId: pool.pickupAreaId,
        capacity: pool.capacity,
        // Already counted by the claim above.
        seatsTaken: pool.seatsTaken,
        memberBearingsDeg: await activeMemberBearings(tx, pool.id),
      },
      {
        pickupAreaId: ride.pickupAreaId,
        seats: ride.seatsRequested,
        bearingDeg: ride.bearingDeg,
      },
      env.pooling,
    );
    if (!confirmed.eligible && confirmed.reason) {
      throw matchingFailure(confirmed.reason, confirmed.bearingDiffDeg);
    }

    if (!(await tryClaimRide(tx, ride.id))) {
      throw new AppError('RIDE_ALREADY_MATCHED', {
        message: 'Another driver accepted that request first.',
      });
    }

    // The unique index on ride_request_id is the final guard: a retried or
    // double-clicked join cannot produce a second membership.
    await tx.poolMember.create({
      data: {
        poolId: pool.id,
        rideRequestId: ride.id,
        seats: ride.seatsRequested,
        farePaisa: 0n,
      },
    });

    // Everyone's price changes now that the distance is shared.
    await recalculatePoolFares(tx, pool.id, env.fare);

    await recordTransition(tx, {
      poolId: pool.id,
      toStatus: 'MEMBER_JOINED' satisfies PoolEvent,
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note: `Seats claimed (${ride.seatsRequested})`,
    });
    await recordTransition(tx, {
      rideRequestId: ride.id,
      fromStatus: 'REQUESTED',
      toStatus: 'MATCHED',
      actorUserId: driverId,
      actorRole: 'DRIVER',
      note: 'Pooled',
    });
  });

  return getPoolForDriver(poolId, driverId);
}

/** Bearings of everyone currently aboard, for the matching rule. */
async function activeMemberBearings(db: DbWriter, poolId: bigint): Promise<number[]> {
  const members = await db.poolMember.findMany({
    where: { poolId, leftAt: null },
    select: {
      rideRequest: {
        select: {
          pickupArea: { select: { latitude: true, longitude: true } },
          dropoffArea: { select: { latitude: true, longitude: true } },
        },
      },
    },
  });

  return members.map((m) =>
    initialBearingDeg(
      toCoordinates(m.rideRequest.pickupArea as never),
      toCoordinates(m.rideRequest.dropoffArea as never),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

export async function getPoolForDriver(poolId: bigint, driverId: bigint) {
  const pool = await prisma.pool.findFirst({
    where: { id: poolId, driverId },
    include: {
      vehicle: { select: { name: true, plateNo: true, capacity: true } },
      pickupArea: { select: { id: true, name: true } },
      members: {
        orderBy: { joinedAt: 'asc' },
        include: {
          rideRequest: {
            select: {
              id: true,
              status: true,
              seatsRequested: true,
              distanceKm: true,
              estimatedFarePaisa: true,
              finalFarePaisa: true,
              paymentMethod: true,
              passenger: { select: { id: true, name: true, phone: true } },
              dropoffArea: { select: { id: true, name: true } },
            },
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select: { fromStatus: true, toStatus: true, createdAt: true, note: true },
      },
    },
  });

  if (!pool) {
    throw new AppError('POOL_NOT_FOUND');
  }

  return {
    id: pool.id,
    status: pool.status,
    seatsTaken: pool.seatsTaken,
    capacity: pool.capacity,
    freeSeats: pool.capacity - pool.seatsTaken,
    vehicle: pool.vehicle,
    pickupArea: pool.pickupArea,
    createdAt: pool.createdAt,
    arrivedAt: pool.arrivedAt,
    startedAt: pool.startedAt,
    completedAt: pool.completedAt,
    cancelledAt: pool.cancelledAt,
    // The driver sees fares because the driver collects the money.
    members: pool.members.map((member) => ({
      rideRequestId: member.rideRequest.id,
      status: member.rideRequest.status,
      passenger: member.rideRequest.passenger,
      dropoffArea: member.rideRequest.dropoffArea,
      seats: member.seats,
      distanceKm: member.rideRequest.distanceKm.toFixed(3),
      farePaisa: member.farePaisa,
      finalFarePaisa: member.rideRequest.finalFarePaisa,
      paymentMethod: member.rideRequest.paymentMethod,
      joinedAt: member.joinedAt,
      leftAt: member.leftAt,
      active: member.leftAt === null,
    })),
    totalFarePaisa: pool.members
      .filter((m) => m.leftAt === null)
      .reduce((sum, m) => sum + m.farePaisa, 0n),
    timeline: pool.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      at: entry.createdAt,
      note: entry.note,
    })),
  };
}

export async function getCurrentPoolForDriver(driverId: bigint) {
  const pool = await prisma.pool.findFirst({
    where: { driverId, status: { in: ACTIVE_POOL_STATUSES } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });

  return pool ? getPoolForDriver(pool.id, driverId) : null;
}
