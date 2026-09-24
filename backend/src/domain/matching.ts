import { angularDifferenceDeg } from '../lib/geo.js';
import { poolAcceptsMembers, type PoolStatus } from './status.js';

/**
 * The matching rule.
 *
 * Two requests may share a Tesla when all of the following hold:
 *   1. same pickup area,
 *   2. their pickup→dropoff bearings differ by no more than the threshold,
 *   3. enough seats remain,
 *   4. the pool is still FORMING.
 *
 * Bearing rather than distance-between-destinations, because distance breaks down
 * exactly where it matters: two destinations 2km apart are a reasonable detour if
 * they lie further along the same road, and a terrible one if they are in
 * opposite directions. Bearing captures "are we going the same way", which is the
 * thing that actually decides whether sharing makes sense.
 *
 * Pure and database-free, so the rule can be tested directly against the brief's
 * own Nusrat/Rafiq example.
 */

export const POOLABILITY_REASONS = [
  'POOL_NOT_FORMING',
  'DIFFERENT_PICKUP_AREA',
  'NOT_ENOUGH_SEATS',
  'ROUTE_NOT_COMPATIBLE',
] as const;
export type PoolabilityReason = (typeof POOLABILITY_REASONS)[number];

export interface MatchingConfig {
  maxBearingDiffDeg: number;
}

export interface PoolSnapshot {
  status: PoolStatus;
  pickupAreaId: number;
  capacity: number;
  seatsTaken: number;
  /**
   * Bearing of every **active** member's pickup→dropoff, in degrees. Empty for a
   * pool that has no members yet.
   */
  memberBearingsDeg: number[];
}

export interface RideCandidate {
  pickupAreaId: number;
  seats: number;
  bearingDeg: number;
}

export interface PoolabilityResult {
  eligible: boolean;
  /**
   * The **largest** bearing difference against any existing member — the worst
   * case, which is the number the threshold is applied to. Null when the pool has
   * no members to compare against, or when an earlier check already failed.
   */
  bearingDiffDeg: number | null;
  reason: PoolabilityReason | null;
  freeSeats: number;
}

/** Whether two individual routes are compatible. Used to group the driver feed. */
export function areRoutesCompatible(
  bearingA: number,
  bearingB: number,
  config: MatchingConfig,
): boolean {
  return angularDifferenceDeg(bearingA, bearingB) <= config.maxBearingDiffDeg;
}

export function evaluatePoolability(
  pool: PoolSnapshot,
  candidate: RideCandidate,
  config: MatchingConfig,
): PoolabilityResult {
  const freeSeats = pool.capacity - pool.seatsTaken;

  // Checks run cheapest-and-most-decisive first, so the reason returned to the
  // driver is the one that actually blocks them rather than an incidental one.
  if (!poolAcceptsMembers(pool.status)) {
    return { eligible: false, bearingDiffDeg: null, reason: 'POOL_NOT_FORMING', freeSeats };
  }

  if (pool.pickupAreaId !== candidate.pickupAreaId) {
    return {
      eligible: false,
      bearingDiffDeg: null,
      reason: 'DIFFERENT_PICKUP_AREA',
      freeSeats,
    };
  }

  if (candidate.seats > freeSeats) {
    return { eligible: false, bearingDiffDeg: null, reason: 'NOT_ENOUGH_SEATS', freeSeats };
  }

  /**
   * Compared against **every** existing member, not just the first.
   *
   * Checking only the anchor would permit transitive drift: A and B within 45°,
   * B and C within 45°, but A and C 90° apart and sharing a vehicle. Taking the
   * worst case keeps the whole pool inside one corridor.
   */
  const worstDiff = pool.memberBearingsDeg.reduce(
    (worst, memberBearing) =>
      Math.max(worst, angularDifferenceDeg(memberBearing, candidate.bearingDeg)),
    0,
  );

  if (pool.memberBearingsDeg.length === 0) {
    return { eligible: true, bearingDiffDeg: null, reason: null, freeSeats };
  }

  if (worstDiff > config.maxBearingDiffDeg) {
    return {
      eligible: false,
      bearingDiffDeg: roundToTenth(worstDiff),
      reason: 'ROUTE_NOT_COMPATIBLE',
      freeSeats,
    };
  }

  return {
    eligible: true,
    bearingDiffDeg: roundToTenth(worstDiff),
    reason: null,
    freeSeats,
  };
}

/**
 * Reported to one decimal place. The threshold comparison above uses the full
 * precision value — rounding first could let a 45.04° pair through.
 */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
