/**
 * The two lifecycles, declared as plain string unions rather than imported from
 * the generated Prisma client.
 *
 * That keeps the state machine, matching rule and fare engine testable with no
 * database and no `prisma generate` step. Prisma's generated enums are string
 * unions with these same members, so the two are structurally compatible and a
 * mismatch is a compile error at the repository boundary.
 */

/** One passenger's journey. Names follow the brief's suggested lifecycle. */
export const RIDE_STATUSES = [
  'REQUESTED',
  'MATCHED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** One vehicle's trip. */
export const POOL_STATUSES = [
  'FORMING',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

/** Statuses from which nothing further can happen. */
export const TERMINAL_RIDE_STATUSES = ['COMPLETED', 'CANCELLED'] as const satisfies
  readonly RideStatus[];
export const TERMINAL_POOL_STATUSES = ['COMPLETED', 'CANCELLED'] as const satisfies
  readonly PoolStatus[];

export function isTerminalRideStatus(status: RideStatus): boolean {
  return (TERMINAL_RIDE_STATUSES as readonly RideStatus[]).includes(status);
}

export function isTerminalPoolStatus(status: PoolStatus): boolean {
  return (TERMINAL_POOL_STATUSES as readonly PoolStatus[]).includes(status);
}

/**
 * A passenger may cancel up to and including DRIVER_ARRIVED. Once STARTED they
 * are physically in the vehicle and the fare is locked, so cancelling is
 * meaningless rather than merely disallowed.
 */
export const CANCELLABLE_RIDE_STATUSES = [
  'REQUESTED',
  'MATCHED',
  'DRIVER_ARRIVED',
] as const satisfies readonly RideStatus[];

export function isCancellableRideStatus(status: RideStatus): boolean {
  return (CANCELLABLE_RIDE_STATUSES as readonly RideStatus[]).includes(status);
}

/**
 * FORMING is the only status that accepts new members. This is what stops a
 * stranger being added to a Tesla that has already driven off — a rule that is
 * easy to state precisely because the pool has its own status.
 */
export function poolAcceptsMembers(status: PoolStatus): boolean {
  return status === 'FORMING';
}
