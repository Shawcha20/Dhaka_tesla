import { describe, expect, it } from 'vitest';

import { POOL_STATUSES, RIDE_STATUSES } from '../../src/domain/status.js';
import {
  assertPoolTransition,
  assertRideTransition,
  canTransitionPool,
  canTransitionRide,
  nextPoolStatuses,
  nextRideStatuses,
  requeueStatusFor,
} from '../../src/domain/transitions.js';
import { AppError } from '../../src/lib/errors.js';

describe('the happy path', () => {
  it('walks a ride from request to completion', () => {
    expect(canTransitionRide('REQUESTED', 'MATCHED', 'DRIVER')).toBe(true);
    expect(canTransitionRide('MATCHED', 'DRIVER_ARRIVED', 'DRIVER')).toBe(true);
    expect(canTransitionRide('DRIVER_ARRIVED', 'STARTED', 'DRIVER')).toBe(true);
    expect(canTransitionRide('STARTED', 'COMPLETED', 'DRIVER')).toBe(true);
  });

  it('walks a pool from forming to completion', () => {
    expect(canTransitionPool('FORMING', 'DRIVER_ARRIVED', 'DRIVER')).toBe(true);
    expect(canTransitionPool('DRIVER_ARRIVED', 'STARTED', 'DRIVER')).toBe(true);
    expect(canTransitionPool('STARTED', 'COMPLETED', 'DRIVER')).toBe(true);
  });
});

describe('illegal transitions are rejected', () => {
  it('refuses to skip stages', () => {
    expect(canTransitionRide('REQUESTED', 'STARTED')).toBe(false);
    expect(canTransitionRide('REQUESTED', 'COMPLETED')).toBe(false);
    expect(canTransitionRide('MATCHED', 'COMPLETED')).toBe(false);
    expect(canTransitionPool('FORMING', 'STARTED')).toBe(false);
    expect(canTransitionPool('FORMING', 'COMPLETED')).toBe(false);
  });

  it('refuses to go backwards', () => {
    expect(canTransitionRide('STARTED', 'MATCHED')).toBe(false);
    expect(canTransitionRide('COMPLETED', 'STARTED')).toBe(false);
    expect(canTransitionRide('DRIVER_ARRIVED', 'MATCHED')).toBe(false);
    expect(canTransitionPool('STARTED', 'FORMING')).toBe(false);
  });

  it('refuses any move out of a terminal state', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED'] as const) {
      expect(nextRideStatuses(terminal)).toEqual([]);
      for (const to of RIDE_STATUSES) {
        expect(canTransitionRide(terminal, to)).toBe(false);
      }
    }

    for (const terminal of ['COMPLETED', 'CANCELLED'] as const) {
      expect(nextPoolStatuses(terminal)).toEqual([]);
      for (const to of POOL_STATUSES) {
        expect(canTransitionPool(terminal, to)).toBe(false);
      }
    }
  });

  it('refuses a transition to the same status', () => {
    for (const status of RIDE_STATUSES) {
      expect(canTransitionRide(status, status)).toBe(false);
    }
    for (const status of POOL_STATUSES) {
      expect(canTransitionPool(status, status)).toBe(false);
    }
  });

  it('never allows cancelling a ride that has started', () => {
    // The passenger is in the vehicle and the fare is locked. This is the rule
    // behind RIDE_NOT_CANCELLABLE.
    expect(canTransitionRide('STARTED', 'CANCELLED')).toBe(false);
    expect(canTransitionRide('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('never allows cancelling a pool that has started', () => {
    expect(canTransitionPool('STARTED', 'CANCELLED')).toBe(false);
  });
});

describe('who may do what', () => {
  it('lets only the driver advance a ride', () => {
    for (const [from, to] of [
      ['REQUESTED', 'MATCHED'],
      ['MATCHED', 'DRIVER_ARRIVED'],
      ['DRIVER_ARRIVED', 'STARTED'],
      ['STARTED', 'COMPLETED'],
    ] as const) {
      expect(canTransitionRide(from, to, 'DRIVER')).toBe(true);
      expect(canTransitionRide(from, to, 'PASSENGER')).toBe(false);
    }
  });

  it('lets a passenger cancel but not start their own ride', () => {
    expect(canTransitionRide('REQUESTED', 'CANCELLED', 'PASSENGER')).toBe(true);
    expect(canTransitionRide('MATCHED', 'CANCELLED', 'PASSENGER')).toBe(true);
    expect(canTransitionRide('DRIVER_ARRIVED', 'CANCELLED', 'PASSENGER')).toBe(true);

    expect(canTransitionRide('DRIVER_ARRIVED', 'STARTED', 'PASSENGER')).toBe(false);
  });

  it('lets a driver cancel a no-show only once they have arrived', () => {
    expect(canTransitionRide('DRIVER_ARRIVED', 'CANCELLED', 'DRIVER')).toBe(true);
    // Before arriving there is no no-show to declare.
    expect(canTransitionRide('REQUESTED', 'CANCELLED', 'DRIVER')).toBe(false);
    expect(canTransitionRide('MATCHED', 'CANCELLED', 'DRIVER')).toBe(false);
  });

  it('reserves the requeue path for the system alone', () => {
    // Requeueing happens when a driver kills the pool. Neither party asked for
    // it, so neither party is the actor.
    expect(canTransitionRide('MATCHED', 'REQUESTED', 'SYSTEM')).toBe(true);
    expect(canTransitionRide('MATCHED', 'REQUESTED', 'PASSENGER')).toBe(false);
    expect(canTransitionRide('MATCHED', 'REQUESTED', 'DRIVER')).toBe(false);
  });

  it('gives the pool machine no system transitions at all', () => {
    for (const from of POOL_STATUSES) {
      for (const to of POOL_STATUSES) {
        expect(canTransitionPool(from, to, 'SYSTEM')).toBe(false);
      }
    }
  });
});

describe('assert variants', () => {
  it('passes silently on a legal transition', () => {
    expect(() => assertRideTransition('REQUESTED', 'MATCHED', 'DRIVER')).not.toThrow();
    expect(() => assertPoolTransition('FORMING', 'DRIVER_ARRIVED', 'DRIVER')).not.toThrow();
  });

  it('reports an impossible transition as INVALID_STATE_TRANSITION', () => {
    try {
      assertRideTransition('REQUESTED', 'COMPLETED', 'DRIVER');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((e as AppError).status).toBe(409);
    }
  });

  it('reports a wrong actor as FORBIDDEN_ROLE, not as an invalid transition', () => {
    // "That cannot happen" and "not by you" are different answers, and a client
    // should be able to tell them apart.
    try {
      assertRideTransition('DRIVER_ARRIVED', 'STARTED', 'PASSENGER');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('FORBIDDEN_ROLE');
      expect((e as AppError).status).toBe(403);
    }
  });

  it('names the legal next steps in the error context', () => {
    try {
      assertRideTransition('REQUESTED', 'COMPLETED', 'DRIVER');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as AppError).context?.['allowed']).toEqual(['MATCHED', 'CANCELLED']);
    }
  });
});

describe('nextStatuses', () => {
  it('lists the reachable statuses', () => {
    expect(nextRideStatuses('REQUESTED')).toEqual(['MATCHED', 'CANCELLED']);
    expect(nextRideStatuses('STARTED')).toEqual(['COMPLETED']);
    expect(nextPoolStatuses('FORMING')).toEqual(['DRIVER_ARRIVED', 'CANCELLED']);
  });

  it('agrees with canTransition for every pair', () => {
    // Guards against the table and the lookup drifting apart.
    for (const from of RIDE_STATUSES) {
      const reachable = new Set(nextRideStatuses(from));
      for (const to of RIDE_STATUSES) {
        expect(canTransitionRide(from, to)).toBe(reachable.has(to));
      }
    }
  });

  it('covers every declared status, so a new one cannot be forgotten', () => {
    // Adding a status to the union without adding a row would fail to compile;
    // this asserts the table is total at runtime too.
    for (const status of RIDE_STATUSES) {
      expect(Array.isArray(nextRideStatuses(status))).toBe(true);
    }
    for (const status of POOL_STATUSES) {
      expect(Array.isArray(nextPoolStatuses(status))).toBe(true);
    }
  });
});

describe('requeueStatusFor', () => {
  it('requeues a ride that has not yet departed', () => {
    expect(requeueStatusFor('MATCHED')).toBe('REQUESTED');
    expect(requeueStatusFor('DRIVER_ARRIVED')).toBe('REQUESTED');
  });

  it('has nothing to requeue for a ride already moving or finished', () => {
    expect(requeueStatusFor('STARTED')).toBeNull();
    expect(requeueStatusFor('COMPLETED')).toBeNull();
    expect(requeueStatusFor('CANCELLED')).toBeNull();
    expect(requeueStatusFor('REQUESTED')).toBeNull();
  });
});
