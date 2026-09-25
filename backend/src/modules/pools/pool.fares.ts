import { calculateFare, isPooled, type FareConfig } from '../../lib/fare.js';
import type { DbWriter } from '../../lib/history.js';
import { kmToMilliKm } from '../../lib/money.js';

/**
 * Recomputes every active member's fare for a pool.
 *
 * Called whenever membership changes — a passenger joining, or leaving — because
 * the pool discount is a fact about the trip rather than about any one request.
 * Adding Rafiq changes *Nusrat's* price, and if Nusrat then cancels, Rafiq's
 * discount has to go away again.
 *
 * Always invoked inside the caller's transaction, so a member can never be priced
 * for a pool they failed to join.
 */
export async function recalculatePoolFares(
  db: DbWriter,
  poolId: bigint,
  config: FareConfig,
): Promise<void> {
  const members = await db.poolMember.findMany({
    where: { poolId, leftAt: null },
    select: {
      id: true,
      seats: true,
      farePaisa: true,
      rideRequest: { select: { distanceKm: true } },
    },
  });

  const pooled = isPooled(members.length);

  for (const member of members) {
    const fare = calculateFare(
      {
        // DECIMAL(6,3) via its exact string form, never through a float.
        distanceMilliKm: kmToMilliKm(member.rideRequest.distanceKm.toFixed(3)),
        seats: member.seats,
        pooled,
      },
      config,
    );

    // Skipped when unchanged: the common case after a join is that only one of
    // several members actually moves, and an UPDATE that changes nothing is still
    // a write.
    if (fare.totalFarePaisa !== member.farePaisa) {
      await db.poolMember.update({
        where: { id: member.id },
        data: { farePaisa: fare.totalFarePaisa },
      });
    }
  }
}

/**
 * Copies each member's fare onto their ride request, where it becomes immutable.
 *
 * Called once, when the trip starts. After this point `final_fare_paisa` is a fact
 * rather than an estimate: the passenger is in the vehicle and their price cannot
 * change under them.
 */
export async function lockPoolFares(db: DbWriter, poolId: bigint): Promise<void> {
  const members = await db.poolMember.findMany({
    where: { poolId, leftAt: null },
    select: { rideRequestId: true, farePaisa: true },
  });

  for (const member of members) {
    await db.rideRequest.update({
      where: { id: member.rideRequestId },
      data: { finalFarePaisa: member.farePaisa },
    });
  }
}

/**
 * Sums the seats actually held by active members.
 *
 * `pools.seats_taken` is maintained incrementally by the atomic claim, so this
 * exists to prove the two agree — a reconciliation the test suite asserts after
 * concurrent joins.
 */
export async function sumActiveSeats(db: DbWriter, poolId: bigint): Promise<number> {
  const result = await db.poolMember.aggregate({
    where: { poolId, leftAt: null },
    _sum: { seats: true },
  });
  return result._sum.seats ?? 0;
}
