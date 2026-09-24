/**
 * Money handling. Every amount in this system is an integer count of **paisa**
 * held in a `bigint`. 100 paisa = 1 BDT (Taka).
 *
 * The important property is that no float ever touches a monetary value. The
 * fare model divides — a pool discount is a percentage, and percentages of odd
 * amounts produce fractions — so rounding has to happen somewhere. Doing it with
 * integer arithmetic makes "somewhere" a single documented function, and every
 * later addition and comparison stays exact.
 *
 * Distances are handled the same way: `distanceMilliKm` is an integer count of
 * metres, so `perKmPaisa * metres / 1000` is exact integer division rather than a
 * float multiplication whose last decimal place depends on the platform.
 */

export const PAISA_PER_TAKA = 100n;

/** Metres per kilometre — the scaling factor for integer distance arithmetic. */
export const MILLI_PER_UNIT = 1000n;

/**
 * Integer division rounding halves **up** (away from zero).
 *
 * Implemented as `(2n + d) / 2d` rather than `(n + d/2) / d`, because the latter
 * silently loses the half when `d` is odd.
 *
 * Restricted to non-negative numerators on purpose: no fare, discount or balance
 * in this system is ever negative, and "round half up" has two contradictory
 * conventions for negatives (away from zero, or toward positive infinity).
 * Rather than pick one silently, this throws — if a negative ever appears here it
 * is a bug worth surfacing.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`denominator must be positive, received ${denominator}`);
  }
  if (numerator < 0n) {
    throw new RangeError(
      `divRoundHalfUp does not accept negative numerators, received ${numerator}`,
    );
  }
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Applies a whole-number percentage, rounding halves up. */
export function percentOf(amountPaisa: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`percent must be an integer 0-100, received ${percent}`);
  }
  return divRoundHalfUp(amountPaisa * BigInt(percent), 100n);
}

/**
 * Formats paisa as a decimal Taka string: `4159n` becomes `"41.59"`.
 *
 * String-built rather than divided, because dividing by 100 reintroduces exactly
 * the float imprecision this module exists to avoid.
 */
export function formatPaisa(paisa: bigint): string {
  const negative = paisa < 0n;
  const absolute = negative ? -paisa : paisa;
  const whole = absolute / PAISA_PER_TAKA;
  const fraction = absolute % PAISA_PER_TAKA;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;
}

/** `4159n` becomes `"41.59 BDT"`. Presentation only. */
export function formatTaka(paisa: bigint): string {
  return `${formatPaisa(paisa)} BDT`;
}

/**
 * Converts a Taka amount to paisa. Accepts a string to avoid a caller
 * accidentally routing money through a float: `takaToPaisa('41.59')` is exact,
 * whereas `41.59 * 100` is 4158.999999999999.
 */
export function takaToPaisa(taka: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(taka.trim());
  if (!match) {
    throw new RangeError(`not a valid Taka amount: ${taka}`);
  }
  const [, sign, whole, fraction = '0'] = match;
  const paisa =
    BigInt(whole as string) * PAISA_PER_TAKA + BigInt(fraction.padEnd(2, '0'));
  return sign === '-' ? -paisa : paisa;
}

/**
 * Converts a decimal kilometre string (as stored in `DECIMAL(6,3)`) to an integer
 * count of metres, for use in the fare calculation.
 */
export function kmToMilliKm(km: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(km.trim());
  if (!match) {
    throw new RangeError(`not a valid kilometre value: ${km}`);
  }
  const [, whole, fraction = '0'] = match;
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}

/** Formats integer metres back to the 3-decimal kilometre string we store. */
export function milliKmToKm(milliKm: number): string {
  if (!Number.isInteger(milliKm) || milliKm < 0) {
    throw new RangeError(`milliKm must be a non-negative integer, received ${milliKm}`);
  }
  const whole = Math.floor(milliKm / 1000);
  const fraction = milliKm % 1000;
  return `${whole}.${fraction.toString().padStart(3, '0')}`;
}
