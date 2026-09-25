import type { Prisma } from '@prisma/client';

import type { ActorRole } from '../domain/auth.js';

/**
 * Any Prisma client that can write — the base client or a transaction one.
 *
 * Every function that touches more than one row takes this rather than importing
 * `prisma` directly, so it can be composed inside a caller's transaction. Writing
 * a history row outside the transaction that caused the change would let the two
 * disagree, which defeats the point of having an audit trail.
 */
export type DbWriter = Prisma.TransactionClient;

export interface TransitionRecord {
  rideRequestId?: bigint;
  poolId?: bigint;
  fromStatus?: string | null;
  toStatus: string;
  /** Null for SYSTEM actions, which have no human behind them. */
  actorUserId?: bigint | null;
  actorRole: ActorRole;
  note?: string;
}

/**
 * Appends one row to the audit trail.
 *
 * This table is append-only: nothing here is ever updated or deleted. It is what
 * lets the system answer "why was Nusrat charged 41.59 when she was quoted 46.99"
 * after the fact, which the brief asks for explicitly.
 */
export async function recordTransition(
  db: DbWriter,
  entry: TransitionRecord,
): Promise<void> {
  await db.rideStatusHistory.create({
    data: {
      ...(entry.rideRequestId !== undefined ? { rideRequestId: entry.rideRequestId } : {}),
      ...(entry.poolId !== undefined ? { poolId: entry.poolId } : {}),
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus,
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole,
      ...(entry.note !== undefined ? { note: entry.note.slice(0, 255) } : {}),
    },
  });
}

/** Several rows in one insert, for a transition that fans out across a pool. */
export async function recordTransitions(
  db: DbWriter,
  entries: TransitionRecord[],
): Promise<void> {
  if (entries.length === 0) return;

  await db.rideStatusHistory.createMany({
    data: entries.map((entry) => ({
      ...(entry.rideRequestId !== undefined ? { rideRequestId: entry.rideRequestId } : {}),
      ...(entry.poolId !== undefined ? { poolId: entry.poolId } : {}),
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus,
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole,
      ...(entry.note !== undefined ? { note: entry.note.slice(0, 255) } : {}),
    })),
  });
}
