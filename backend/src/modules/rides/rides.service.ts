import { env } from '../../config/env.js';
import {
  TERMINAL_RIDE_STATUSES,
  type PoolEvent,
  type RideStatus,
} from '../../domain/status.js';
import { assertRideTransition } from '../../domain/transitions.js';
import { AppError } from '../../lib/errors.js';
import { calculateFare } from '../../lib/fare.js';
import { distanceMilliKm } from '../../lib/geo.js';
import { recordTransition } from '../../lib/history.js';
import { milliKmToKm } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { loadRoute, toCoordinates } from '../areas/areas.service.js';
import { recalculatePoolFares } from '../pools/pool.fares.js';
import type { CreateRideInput, ListRidesInput, QuoteInput } from './rides.schema.js';

const ACTIVE_STATUSES: RideStatus[] = [
  'REQUESTED',
  'MATCHED',
  'DRIVER_ARRIVED',
  'STARTED',
];

// ─────────────────────────────────────────────────────────────────────────────
// Quote
// ─────────────────────────────────────────────────────────────────────────────

export interface QuoteResult {
  distanceKm: string;
  breakdown: {
    baseFarePaisa: bigint;
    distanceChargePaisa: bigint;
    poolDiscountPaisa: bigint;
    perSeatFarePaisa: bigint;
    seats: number;
  };
  soloFarePaisa: bigint;
  estimatedPooledFarePaisa: bigint;
}

/**
 * Prices a trip without creating anything.
 *
 * Returns both the solo and the pooled figure so the UI can say "46.99, or 41.59
 * if shared" without doing any arithmetic of its own — keeping one implementation
 * of the fare model, on the server.
 */
export async function quote(input: QuoteInput): Promise<QuoteResult> {
  const { pickup, dropoff } = await loadRoute(input.pickupAreaId, input.dropoffAreaId);
  const metres = distanceMilliKm(toCoordinates(pickup), toCoordinates(dropoff));

  const solo = calculateFare(
    { distanceMilliKm: metres, seats: input.seats, pooled: false },
    env.fare,
  );
  const pooled = calculateFare(
    { distanceMilliKm: metres, seats: input.seats, pooled: true },
    env.fare,
  );

  return {
    distanceKm: milliKmToKm(metres),
    breakdown: {
      baseFarePaisa: solo.baseFarePaisa,
      distanceChargePaisa: solo.distanceChargePaisa,
      poolDiscountPaisa: solo.poolDiscountPaisa,
      perSeatFarePaisa: solo.perSeatFarePaisa,
      seats: solo.seats,
    },
    soloFarePaisa: solo.totalFarePaisa,
    estimatedPooledFarePaisa: pooled.totalFarePaisa,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export async function createRide(passengerId: bigint, input: CreateRideInput) {
  const { pickup, dropoff } = await loadRoute(input.pickupAreaId, input.dropoffAreaId);
  const metres = distanceMilliKm(toCoordinates(pickup), toCoordinates(dropoff));

  const fare = calculateFare(
    { distanceMilliKm: metres, seats: input.seats, pooled: false },
    env.fare,
  );

  const ride = await prisma.$transaction(async (tx) => {
    /**
     * Locks the passenger's own user row before checking for an active ride.
     *
     * Without it this is a check-then-insert race: two simultaneous requests both
     * see "no active ride" and both insert, leaving one person in two Teslas.
     * Locking the user row serialises ride creation per passenger, which is the
     * narrowest lock that fixes it — different passengers never contend.
     */
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${passengerId} FOR UPDATE`;

    const active = await tx.rideRequest.count({
      where: { passengerId, status: { in: ACTIVE_STATUSES } },
    });
    if (active > 0) {
      throw new AppError('PASSENGER_HAS_ACTIVE_RIDE');
    }

    const created = await tx.rideRequest.create({
      data: {
        passengerId,
        pickupAreaId: input.pickupAreaId,
        dropoffAreaId: input.dropoffAreaId,
        seatsRequested: input.seats,
        status: 'REQUESTED',
        distanceKm: milliKmToKm(metres),
        estimatedFarePaisa: fare.totalFarePaisa,
        paymentMethod: input.paymentMethod,
      },
    });

    // Creation is itself a transition, from nothing to REQUESTED, so the timeline
    // starts where the ride does.
    await recordTransition(tx, {
      rideRequestId: created.id,
      fromStatus: null,
      toStatus: 'REQUESTED',
      actorUserId: passengerId,
      actorRole: 'PASSENGER',
    });

    return created;
  });

  return getRideForPassenger(ride.id, passengerId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

export async function listRidesForPassenger(
  passengerId: bigint,
  filters: ListRidesInput,
) {
  const rides = await prisma.rideRequest.findMany({
    where: {
      passengerId,
      ...(filters.status ? { status: { in: filters.status } } : {}),
      ...(filters.cursor ? { id: { lt: BigInt(filters.cursor) } } : {}),
    },
    // One extra row, to learn whether another page exists without a second query.
    take: filters.limit + 1,
    orderBy: { id: 'desc' },
    include: {
      pickupArea: { select: { id: true, name: true } },
      dropoffArea: { select: { id: true, name: true } },
      poolMember: {
        select: {
          farePaisa: true,
          pool: { select: { id: true, status: true, seatsTaken: true } },
        },
      },
    },
  });

  const page = rides.slice(0, filters.limit);
  const nextCursor =
    rides.length > filters.limit ? (page.at(-1)?.id.toString() ?? null) : null;

  return {
    data: page.map((ride) => ({
      id: ride.id,
      status: ride.status,
      seats: ride.seatsRequested,
      pickupArea: ride.pickupArea,
      dropoffArea: ride.dropoffArea,
      distanceKm: ride.distanceKm.toFixed(3),
      estimatedFarePaisa: ride.estimatedFarePaisa,
      finalFarePaisa: ride.finalFarePaisa,
      paymentMethod: ride.paymentMethod,
      pooled: (ride.poolMember?.pool.seatsTaken ?? 0) > ride.seatsRequested,
      requestedAt: ride.requestedAt,
      completedAt: ride.completedAt,
      cancelledAt: ride.cancelledAt,
    })),
    meta: { nextCursor },
  };
}

/**
 * One ride in full, including its timeline and who else is aboard.
 *
 * Companions are deliberately thin — first name and destination only. Nusrat can
 * see she is sharing with Rafiq and where he is going, because she is about to sit
 * next to him. She cannot see his fare, phone or email. This is the brief's "each
 * passenger sees their own fare, not anyone else's" made concrete.
 */
export async function getRideForPassenger(rideId: bigint, passengerId: bigint) {
  const ride = await prisma.rideRequest.findFirst({
    // passengerId in the WHERE, not checked afterwards: a missing row and someone
    // else's row are then indistinguishable, so the API never confirms that
    // another user's ride id exists.
    where: { id: rideId, passengerId },
    include: {
      pickupArea: { select: { id: true, name: true } },
      dropoffArea: { select: { id: true, name: true } },
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select: {
          fromStatus: true,
          toStatus: true,
          createdAt: true,
          actorRole: true,
          note: true,
          actor: { select: { name: true } },
        },
      },
      poolMember: {
        select: {
          seats: true,
          farePaisa: true,
          pool: {
            select: {
              id: true,
              status: true,
              seatsTaken: true,
              capacity: true,
              vehicle: { select: { name: true, plateNo: true } },
              driver: { select: { name: true, phone: true } },
              members: {
                where: { leftAt: null },
                select: {
                  seats: true,
                  rideRequest: {
                    select: {
                      id: true,
                      passenger: { select: { name: true } },
                      dropoffArea: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!ride) {
    throw new AppError('RIDE_NOT_FOUND');
  }

  const member = ride.poolMember;
  const pool = member?.pool;

  return {
    id: ride.id,
    status: ride.status,
    seats: ride.seatsRequested,
    pickupArea: ride.pickupArea,
    dropoffArea: ride.dropoffArea,
    distanceKm: ride.distanceKm.toFixed(3),
    estimatedFarePaisa: ride.estimatedFarePaisa,
    // Before the trip starts this is the live pooled figure; after it starts it is
    // the locked one. Either way it is what this passenger owes.
    currentFarePaisa: ride.finalFarePaisa ?? member?.farePaisa ?? ride.estimatedFarePaisa,
    finalFarePaisa: ride.finalFarePaisa,
    paymentMethod: ride.paymentMethod,
    cancelReason: ride.cancelReason,
    requestedAt: ride.requestedAt,
    matchedAt: ride.matchedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
    pool: pool
      ? {
          id: pool.id,
          status: pool.status,
          seatsTaken: pool.seatsTaken,
          capacity: pool.capacity,
          vehicle: pool.vehicle,
          // The driver's phone is shown because the passenger may need to call
          // them; the reverse is available to the driver for the same reason.
          driver: pool.driver,
          companions: pool.members
            .filter((m) => m.rideRequest.id !== ride.id)
            .map((m) => ({
              name: m.rideRequest.passenger.name.split(' ')[0] ?? m.rideRequest.passenger.name,
              dropoffArea: m.rideRequest.dropoffArea.name,
              seats: m.seats,
            })),
        }
      : null,
    timeline: ride.statusHistory.map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      at: entry.createdAt,
      by: entry.actor?.name ?? 'System',
      actorRole: entry.actorRole,
      note: entry.note,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelRide(
  rideId: bigint,
  passengerId: bigint,
  reason: string | undefined,
) {
  await prisma.$transaction(async (tx) => {
    const ride = await tx.rideRequest.findFirst({
      where: { id: rideId, passengerId },
      select: {
        id: true,
        status: true,
        poolMember: { select: { id: true, seats: true, poolId: true, leftAt: true } },
      },
    });

    if (!ride) {
      throw new AppError('RIDE_NOT_FOUND');
    }

    if ((TERMINAL_RIDE_STATUSES as readonly RideStatus[]).includes(ride.status)) {
      throw new AppError('RIDE_NOT_CANCELLABLE', {
        message:
          ride.status === 'CANCELLED'
            ? 'This ride is already cancelled.'
            : 'This ride has already been completed.',
      });
    }

    // The state machine owns the rule. STARTED has no path to CANCELLED, so a
    // passenger already in the vehicle is refused here.
    if (ride.status === 'STARTED') {
      throw new AppError('RIDE_NOT_CANCELLABLE', {
        message: 'The trip has already started.',
      });
    }
    assertRideTransition(ride.status, 'CANCELLED', 'PASSENGER');

    const now = new Date();

    await tx.rideRequest.update({
      where: { id: ride.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: passengerId,
        ...(reason ? { cancelReason: reason } : {}),
      },
    });

    const member = ride.poolMember;
    if (member && !member.leftAt) {
      // Release the seat and re-price whoever is left: if Nusrat leaves and Rafiq
      // is alone again, Rafiq's discount has to go away.
      await tx.poolMember.update({
        where: { id: member.id },
        data: { leftAt: now },
      });

      await tx.$executeRaw`
        UPDATE pools
           SET seats_taken = seats_taken - ${member.seats}
         WHERE id = ${member.poolId}
           AND seats_taken >= ${member.seats}
      `;

      await recalculatePoolFares(tx, member.poolId, env.fare);

      // A membership event rather than a status transition — the pool's own status
      // has not changed. Recorded so the driver's timeline can explain why the
      // seat count dropped. See POOL_EVENTS in domain/status.ts.
      await recordTransition(tx, {
        poolId: member.poolId,
        toStatus: 'MEMBER_LEFT' satisfies PoolEvent,
        actorUserId: passengerId,
        actorRole: 'PASSENGER',
        note: `Seat released (${member.seats})`,
      });
    }

    await recordTransition(tx, {
      rideRequestId: ride.id,
      fromStatus: ride.status,
      toStatus: 'CANCELLED',
      actorUserId: passengerId,
      actorRole: 'PASSENGER',
      ...(reason ? { note: reason } : {}),
    });
  });

  return getRideForPassenger(rideId, passengerId);
}
