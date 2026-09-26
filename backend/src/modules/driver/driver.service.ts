import { env } from '../../config/env.js';
import {
  evaluatePoolability,
  type PoolabilityResult,
} from '../../domain/matching.js';
import { AppError } from '../../lib/errors.js';
import { calculateFare } from '../../lib/fare.js';
import { initialBearingDeg } from '../../lib/geo.js';
import { kmToMilliKm } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { toCoordinates } from '../areas/areas.service.js';
import { ACTIVE_POOL_STATUSES } from '../pools/pool.service.js';
import type { ListRequestsInput } from './driver.schema.js';

/**
 * Going online or offline.
 *
 * Refused mid-trip: passengers are already aboard, and a driver who could vanish
 * from the system while carrying someone would leave those rides unresolvable.
 * Finishing or cancelling the pool is the way out.
 */
export async function setOnlineStatus(driverId: bigint, isOnline: boolean) {
  const vehicle = await prisma.vehicle.findUnique({ where: { driverId } });
  if (!vehicle) {
    throw new AppError('VEHICLE_NOT_FOUND');
  }

  if (!isOnline) {
    const active = await prisma.pool.count({
      where: { driverId, status: { in: ACTIVE_POOL_STATUSES } },
    });
    if (active > 0) {
      throw new AppError('POOL_IN_PROGRESS');
    }
  }

  const updated = await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: { isOnline },
    select: { id: true, name: true, plateNo: true, capacity: true, isOnline: true },
  });

  return updated;
}

export interface DriverRequestDto {
  id: bigint;
  passenger: { name: string };
  pickupArea: { id: number; name: string };
  dropoffArea: { id: number; name: string };
  seats: number;
  distanceKm: string;
  estimatedFarePaisa: bigint;
  /** What this passenger would pay if pooled — what the driver is really offering. */
  pooledFarePaisa: bigint;
  bearingDeg: number;
  waitingSeconds: number;
  poolable: PoolabilityResult;
}

/**
 * The open requests this driver could serve, oldest first.
 *
 * Every entry carries a `poolable` verdict rather than being filtered out, so the
 * matching rule is visible in the UI: a driver sees that a request is in the wrong
 * direction or needs more seats than remain, instead of wondering why it is
 * missing. That turns an opaque algorithm into something a human can predict.
 */
export async function listRelevantRequests(
  driverId: bigint,
  filters: ListRequestsInput,
): Promise<{ pool: { id: bigint; seatsTaken: number; capacity: number } | null; data: DriverRequestDto[] }> {
  const vehicle = await prisma.vehicle.findUnique({ where: { driverId } });
  if (!vehicle) {
    throw new AppError('VEHICLE_NOT_FOUND');
  }

  const activePool = await prisma.pool.findFirst({
    where: { driverId, status: { in: ACTIVE_POOL_STATUSES } },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      status: true,
      capacity: true,
      seatsTaken: true,
      pickupAreaId: true,
      members: {
        where: { leftAt: null },
        select: {
          rideRequest: {
            select: {
              pickupArea: { select: { latitude: true, longitude: true } },
              dropoffArea: { select: { latitude: true, longitude: true } },
            },
          },
        },
      },
    },
  });

  const memberBearingsDeg =
    activePool?.members.map((m) =>
      initialBearingDeg(
        toCoordinates(m.rideRequest.pickupArea as never),
        toCoordinates(m.rideRequest.dropoffArea as never),
      ),
    ) ?? [];

  const requests = await prisma.rideRequest.findMany({
    where: {
      status: 'REQUESTED',
      // Already-seated requests are not on offer, even if still REQUESTED for a
      // moment during a concurrent accept. `none` rather than a null check,
      // because a requeued request keeps its historical membership rows — only a
      // row with leftAt: null means currently aboard.
      poolMembers: { none: { leftAt: null } },
    },
    orderBy: { requestedAt: 'asc' },
    take: filters.limit,
    select: {
      id: true,
      seatsRequested: true,
      distanceKm: true,
      estimatedFarePaisa: true,
      requestedAt: true,
      pickupAreaId: true,
      passenger: { select: { name: true } },
      pickupArea: { select: { id: true, name: true, latitude: true, longitude: true } },
      dropoffArea: { select: { id: true, name: true, latitude: true, longitude: true } },
    },
  });

  const now = Date.now();

  const mapped = requests.map((ride): DriverRequestDto => {
    const bearingDeg = initialBearingDeg(
      toCoordinates(ride.pickupArea as never),
      toCoordinates(ride.dropoffArea as never),
    );

    const poolable: PoolabilityResult = activePool
      ? evaluatePoolability(
          {
            status: activePool.status,
            pickupAreaId: activePool.pickupAreaId,
            capacity: activePool.capacity,
            seatsTaken: activePool.seatsTaken,
            memberBearingsDeg,
          },
          {
            pickupAreaId: ride.pickupAreaId,
            seats: ride.seatsRequested,
            bearingDeg,
          },
          env.pooling,
        )
      : {
          // With no pool open, accepting this request starts one — the only
          // constraint is that the vehicle is big enough.
          eligible: ride.seatsRequested <= vehicle.capacity,
          bearingDiffDeg: null,
          reason: ride.seatsRequested <= vehicle.capacity ? null : 'NOT_ENOUGH_SEATS',
          freeSeats: vehicle.capacity,
        };

    const pooledFare = calculateFare(
      {
        distanceMilliKm: kmToMilliKm(ride.distanceKm.toFixed(3)),
        seats: ride.seatsRequested,
        pooled: true,
      },
      env.fare,
    );

    return {
      id: ride.id,
      // First name only. The driver needs to recognise who is waiting, not hold a
      // contact record for someone who has not accepted them yet.
      passenger: { name: ride.passenger.name.split(' ')[0] ?? ride.passenger.name },
      pickupArea: { id: ride.pickupArea.id, name: ride.pickupArea.name },
      dropoffArea: { id: ride.dropoffArea.id, name: ride.dropoffArea.name },
      seats: ride.seatsRequested,
      distanceKm: ride.distanceKm.toFixed(3),
      estimatedFarePaisa: ride.estimatedFarePaisa,
      pooledFarePaisa: pooledFare.totalFarePaisa,
      bearingDeg: Math.round(bearingDeg * 10) / 10,
      waitingSeconds: Math.max(0, Math.floor((now - ride.requestedAt.getTime()) / 1000)),
      poolable,
    };
  });

  return {
    pool: activePool
      ? { id: activePool.id, seatsTaken: activePool.seatsTaken, capacity: activePool.capacity }
      : null,
    data: filters.poolableOnly ? mapped.filter((r) => r.poolable.eligible) : mapped,
  };
}
