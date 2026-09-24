import { divRoundHalfUp, MILLI_PER_UNIT, percentOf } from './money.js';

/**
 * The fare model.
 *
 *   distanceCharge = perKmPaisa × distanceKm          (rounded half up)
 *   poolDiscount   = pooled ? distanceCharge × pct%   (rounded half up) : 0
 *   perSeatFare    = baseFare + distanceCharge − poolDiscount
 *   passengerFare  = perSeatFare × seats
 *
 * Pure: config is passed in rather than read from the environment, so the
 * hand-checked expectations in the tests cannot be broken by someone's local
 * .env, and no database or process state is needed to exercise it.
 */

export interface FareConfig {
  /** Fixed charge per seat, covering the pickup itself. Never discounted. */
  baseFarePaisa: number;
  perKmPaisa: number;
  /** Whole-number percentage taken off the distance component when sharing. */
  poolDiscountPct: number;
}

export interface FareInput {
  /** Integer metres, from `distanceMilliKm`. */
  distanceMilliKm: number;
  seats: number;
  /**
   * True when this passenger is sharing with at least one other. The discount is
   * a fact about the trip, not about the request, which is why it is an input
   * here and why fares are recomputed whenever pool membership changes.
   */
  pooled: boolean;
}

export interface FareBreakdown {
  baseFarePaisa: bigint;
  distanceChargePaisa: bigint;
  poolDiscountPaisa: bigint;
  /** What one seat costs after any discount. */
  perSeatFarePaisa: bigint;
  seats: number;
  /** perSeatFarePaisa × seats — what this passenger actually owes. */
  totalFarePaisa: bigint;
}

export function calculateFare(input: FareInput, config: FareConfig): FareBreakdown {
  if (!Number.isInteger(input.distanceMilliKm) || input.distanceMilliKm <= 0) {
    throw new RangeError(
      `distanceMilliKm must be a positive integer, received ${input.distanceMilliKm}`,
    );
  }
  if (!Number.isInteger(input.seats) || input.seats < 1) {
    throw new RangeError(`seats must be a positive integer, received ${input.seats}`);
  }

  const baseFarePaisa = BigInt(config.baseFarePaisa);

  // Integer throughout: perKmPaisa × metres, then divided by 1000 with halves
  // rounded up. For Banani → Mohakhali that is 1500 × 1799 = 2_698_500, and
  // 2_698_500 / 1000 = 2698.5, which rounds to 2699.
  const distanceChargePaisa = divRoundHalfUp(
    BigInt(config.perKmPaisa) * BigInt(input.distanceMilliKm),
    MILLI_PER_UNIT,
  );

  /**
   * The discount applies to the distance component only, never the base fare.
   *
   * The base fare represents the cost of the pickup — the driver's time getting
   * there, the stopping and waiting — and that does not get cheaper because a
   * second passenger climbs in. What genuinely is shared is the distance
   * travelled together. This also keeps the driver's floor intact: however many
   * people share, the driver still earns the full base fare per passenger.
   */
  const poolDiscountPaisa = input.pooled
    ? percentOf(distanceChargePaisa, config.poolDiscountPct)
    : 0n;

  const perSeatFarePaisa = baseFarePaisa + distanceChargePaisa - poolDiscountPaisa;

  return {
    baseFarePaisa,
    distanceChargePaisa,
    poolDiscountPaisa,
    perSeatFarePaisa,
    seats: input.seats,
    totalFarePaisa: perSeatFarePaisa * BigInt(input.seats),
  };
}

/**
 * A pool discount applies once there are at least two members. Expressed as a
 * named function because the rule is referenced from several places — quoting,
 * joining, and recomputing after a cancellation — and duplicating `> 1` in each
 * would be three chances to disagree.
 */
export function isPooled(activeMemberCount: number): boolean {
  return activeMemberCount > 1;
}
