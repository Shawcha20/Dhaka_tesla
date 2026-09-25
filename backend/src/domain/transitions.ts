import { AppError } from '../lib/errors.js';
import type { ActorRole } from './auth.js';
import type { PoolStatus, RideStatus } from './status.js';

/**
 * The two state machines, as data.
 *
 * Declaring transitions as a table rather than scattering `if (status === ...)`
 * checks through the services has three consequences worth the indirection:
 * an illegal transition is impossible to reach by accident, the whole lifecycle
 * can be read in one place, and every rule is testable without a database.
 *
 * Each rule also names who may perform it, so "a passenger cannot start their own
 * ride" is enforced by the machine rather than remembered at each call site.
 */

interface Rule<S> {
  to: S;
  actors: readonly ActorRole[];
}

/**
 * One passenger's journey.
 *
 * The SYSTEM transitions back to REQUESTED are the interesting ones: when a driver
 * cancels a pool, its members did not give up, so marking them CANCELLED would be
 * a lie. They return to the queue to be matched again, and the actor is SYSTEM
 * because no human made that choice.
 */
const RIDE_RULES: Record<RideStatus, readonly Rule<RideStatus>[]> = {
  REQUESTED: [
    { to: 'MATCHED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['PASSENGER'] },
  ],
  MATCHED: [
    { to: 'DRIVER_ARRIVED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['PASSENGER'] },
    { to: 'REQUESTED', actors: ['SYSTEM'] },
  ],
  DRIVER_ARRIVED: [
    { to: 'STARTED', actors: ['DRIVER'] },
    // The driver may cancel here too: the passenger never showed up.
    { to: 'CANCELLED', actors: ['PASSENGER', 'DRIVER'] },
    { to: 'REQUESTED', actors: ['SYSTEM'] },
  ],
  // Once moving, the only way out is arriving. The fare is locked and the
  // passenger is in the vehicle, so there is nothing left to cancel.
  STARTED: [{ to: 'COMPLETED', actors: ['DRIVER'] }],
  COMPLETED: [],
  CANCELLED: [],
};

/** One vehicle's trip. Only the driver drives it; there is no SYSTEM path. */
const POOL_RULES: Record<PoolStatus, readonly Rule<PoolStatus>[]> = {
  FORMING: [
    { to: 'DRIVER_ARRIVED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['DRIVER'] },
  ],
  DRIVER_ARRIVED: [
    { to: 'STARTED', actors: ['DRIVER'] },
    { to: 'CANCELLED', actors: ['DRIVER'] },
  ],
  STARTED: [{ to: 'COMPLETED', actors: ['DRIVER'] }],
  COMPLETED: [],
  CANCELLED: [],
};

function lookup<S extends string>(
  rules: Record<S, readonly Rule<S>[]>,
  from: S,
  to: S,
): Rule<S> | undefined {
  return rules[from].find((rule) => rule.to === to);
}

export function canTransitionRide(
  from: RideStatus,
  to: RideStatus,
  actor?: ActorRole,
): boolean {
  const rule = lookup(RIDE_RULES, from, to);
  if (!rule) return false;
  return actor === undefined || rule.actors.includes(actor);
}

export function canTransitionPool(
  from: PoolStatus,
  to: PoolStatus,
  actor?: ActorRole,
): boolean {
  const rule = lookup(POOL_RULES, from, to);
  if (!rule) return false;
  return actor === undefined || rule.actors.includes(actor);
}

/**
 * Throwing variants, used by the services.
 *
 * The distinction in the error matters: an impossible transition is a 409
 * INVALID_STATE_TRANSITION, whereas a legal transition attempted by the wrong
 * party is a 403 — the difference between "that cannot happen" and "not by you".
 */
export function assertRideTransition(
  from: RideStatus,
  to: RideStatus,
  actor: ActorRole,
): void {
  const rule = lookup(RIDE_RULES, from, to);
  if (!rule) {
    throw new AppError('INVALID_STATE_TRANSITION', {
      message: `A ride cannot go from ${from} to ${to}.`,
      context: { from, to, allowed: nextRideStatuses(from) },
    });
  }
  if (!rule.actors.includes(actor)) {
    throw new AppError('FORBIDDEN_ROLE', {
      message: `A ${actor.toLowerCase()} cannot move a ride from ${from} to ${to}.`,
      context: { from, to, actor, allowedActors: rule.actors },
    });
  }
}

export function assertPoolTransition(
  from: PoolStatus,
  to: PoolStatus,
  actor: ActorRole,
): void {
  const rule = lookup(POOL_RULES, from, to);
  if (!rule) {
    throw new AppError('INVALID_STATE_TRANSITION', {
      message: `A pool cannot go from ${from} to ${to}.`,
      context: { from, to, allowed: nextPoolStatuses(from) },
    });
  }
  if (!rule.actors.includes(actor)) {
    throw new AppError('FORBIDDEN_ROLE', {
      message: `A ${actor.toLowerCase()} cannot move a pool from ${from} to ${to}.`,
      context: { from, to, actor, allowedActors: rule.actors },
    });
  }
}

/** Exposed so the API can tell a client what is possible next. */
export function nextRideStatuses(from: RideStatus): RideStatus[] {
  return RIDE_RULES[from].map((rule) => rule.to);
}

export function nextPoolStatuses(from: PoolStatus): PoolStatus[] {
  return POOL_RULES[from].map((rule) => rule.to);
}

/**
 * When a pool is cancelled, each member's ride moves here.
 *
 * A ride already past DRIVER_ARRIVED has no requeue path — but a pool cannot be
 * cancelled from STARTED either, so that combination is unreachable. Returning
 * null rather than throwing keeps the caller's intent explicit.
 */
export function requeueStatusFor(from: RideStatus): RideStatus | null {
  return canTransitionRide(from, 'REQUESTED', 'SYSTEM') ? 'REQUESTED' : null;
}
