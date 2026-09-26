import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import type { DbWriter } from '../../lib/history.js';

/**
 * The two consequences of a driver cancelling an accepted trip.
 *
 * Cancelling itself is never refused. A driver whose battery has died must be able
 * to release their passengers, and a rule that trapped them in a trip they cannot
 * make would hurt the passengers most. So the consequences land afterwards, and
 * both are about what the driver may accept next:
 *
 * 1. **That driver stops seeing those passengers.** A pool cancel returns its
 *    passengers to REQUESTED so another driver can take them. Without this rule
 *    they reappeared on the board of the driver who had just dropped them, who
 *    could accept and cancel them again indefinitely. Other drivers are
 *    unaffected: the request stays open to everyone else.
 *
 * 2. **Too many cancellations suspends accepting.** More than
 *    DRIVER_CANCEL_LIMIT inside a rolling window, and new trips are refused until
 *    the oldest of them ages out. Rolling rather than "per calendar day", so a
 *    burst at 23:50 does not reset ten minutes later.
 *
 * Both are derived from the pool history that already exists: a pool reaches
 * CANCELLED only through its own driver's cancel, so counting those rows is an
 * exact count of driver cancellations, and no new table can drift out of step with
 * it.
 */

export interface CancellationStanding {
  /** Trips this driver cancelled inside the current window. */
  used: number;
  limit: number;
  windowHours: number;
  /** Set only while suspended: the moment enough cancellations age out. */
  suspendedUntil: Date | null;
}

export async function getCancellationStanding(
  db: DbWriter,
  driverId: bigint,
  now: Date = new Date(),
): Promise<CancellationStanding> {
  const { limit, windowHours } = env.driverCancellations;
  const windowMs = windowHours * 3_600_000;
  const since = new Date(now.getTime() - windowMs);

  const where = { driverId, status: 'CANCELLED' as const, cancelledAt: { gte: since } };

  // Sequential, not Promise.all: this also runs inside interactive transactions,
  // whose queries share one connection and must not be issued concurrently.
  const used = await db.pool.count({ where });
  // Only the newest `limit` matter for when the suspension lifts.
  const newest = await db.pool.findMany({
    where,
    orderBy: { cancelledAt: 'desc' },
    take: limit,
    select: { cancelledAt: true },
  });

  /**
   * The count falls back under the limit once the limit-th most recent cancellation
   * leaves the window — every older one is already outside it, or leaves first.
   */
  const pivot = used >= limit ? newest[limit - 1]?.cancelledAt : null;

  return {
    used,
    limit,
    windowHours,
    suspendedUntil: pivot ? new Date(pivot.getTime() + windowMs) : null,
  };
}

export async function assertMayAcceptTrips(db: DbWriter, driverId: bigint): Promise<void> {
  const standing = await getCancellationStanding(db, driverId);
  if (!standing.suspendedUntil) return;

  const until = standing.suspendedUntil.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  });

  throw new AppError('DRIVER_CANCEL_LIMIT_REACHED', {
    message:
      `You cancelled ${standing.used} trips in the last ${standing.windowHours} hours, ` +
      `the limit is ${standing.limit}. You can accept new trips again at ${until}.`,
  });
}

/**
 * True when this driver previously cancelled a trip carrying this request.
 *
 * Membership rows survive a cancel with `leftAt` set, which is what makes this
 * answerable at all — it is the same history the audit trail relies on.
 */
export async function wasDroppedByDriver(
  db: DbWriter,
  driverId: bigint,
  rideRequestId: bigint,
): Promise<boolean> {
  const count = await db.poolMember.count({
    where: { rideRequestId, pool: { driverId, status: 'CANCELLED' } },
  });
  return count > 0;
}

export async function assertNotDroppedByDriver(
  db: DbWriter,
  driverId: bigint,
  rideRequestId: bigint,
): Promise<void> {
  if (await wasDroppedByDriver(db, driverId, rideRequestId)) {
    throw new AppError('RIDE_PREVIOUSLY_CANCELLED_BY_YOU');
  }
}
