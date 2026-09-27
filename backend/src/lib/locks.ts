import { Prisma } from '@prisma/client';

import type { DbWriter } from './history.js';

/**
 * The one rule for changing who is aboard a trip: **lock the pool row first.**
 *
 * A trip's membership is changed from two sides — the passenger cancelling, the
 * driver arriving, starting, completing or cancelling — and both sides also touch
 * the passengers' ride rows. Before this rule the passenger side locked ride then
 * pool while the driver side locked pool then ride. That is the textbook recipe
 * for a deadlock, and worse, both sides read before they locked and wrote
 * unconditionally, so a cancel racing a start could leave a passenger told they
 * had cancelled while riding, and charged. Taking the pool lock first, on both
 * sides, turns every such pair into a queue: whoever locks second waits, then
 * sees what the first did.
 *
 * Seat claims already follow the rule: their conditional UPDATE on `pools` is the
 * lock (see tryClaimSeats).
 */
export async function lockPool(db: DbWriter, poolId: bigint): Promise<void> {
  await db.$queryRaw`SELECT id FROM pools WHERE id = ${poolId} FOR UPDATE`;
}

/**
 * Isolation for transactions that follow the lock-the-pool rule.
 *
 * MySQL's default, REPEATABLE READ, answers every plain read from a snapshot taken
 * at the transaction's first read. After waiting on a lock, that snapshot can
 * predate the very change being waited for — the driver would acquire the pool,
 * then still see a passenger who cancelled a moment ago, and lock her fare.
 * READ COMMITTED makes each read see what has actually committed, which is the
 * whole point of having waited.
 */
export const MEMBERSHIP_TRANSACTION = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;
