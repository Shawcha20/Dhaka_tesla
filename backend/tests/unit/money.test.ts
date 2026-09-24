import { describe, expect, it } from 'vitest';

import {
  divRoundHalfUp,
  formatPaisa,
  formatTaka,
  kmToMilliKm,
  milliKmToKm,
  percentOf,
  takaToPaisa,
} from '../../src/lib/money.js';

describe('divRoundHalfUp', () => {
  it('rounds an exact half up', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(divRoundHalfUp(2_698_500n, 1000n)).toBe(2699n); // the README case
  });

  it('rounds below a half down', () => {
    expect(divRoundHalfUp(2_698_499n, 1000n)).toBe(2698n);
  });

  it('leaves exact division alone', () => {
    expect(divRoundHalfUp(4000n, 1000n)).toBe(4n);
    expect(divRoundHalfUp(0n, 7n)).toBe(0n);
  });

  it('keeps the half when the denominator is odd', () => {
    // The reason this is implemented as (2n + d) / 2d: with (n + d/2) / d the
    // integer division of d/2 silently discards the half for odd denominators.
    expect(divRoundHalfUp(3n, 3n)).toBe(1n);
    expect(divRoundHalfUp(5n, 3n)).toBe(2n); // 1.667 → 2
    expect(divRoundHalfUp(4n, 3n)).toBe(1n); // 1.333 → 1
  });

  it('refuses a non-positive denominator', () => {
    expect(() => divRoundHalfUp(10n, 0n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(10n, -2n)).toThrow(RangeError);
  });

  it('refuses a negative numerator rather than guessing a convention', () => {
    // "Round half up" means away from zero to some, toward +infinity to others.
    // No money here is ever negative, so this surfaces the bug instead.
    expect(() => divRoundHalfUp(-5n, 2n)).toThrow(RangeError);
  });

  it('stays exact at magnitudes that would break a float', () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(divRoundHalfUp(huge * 1000n, 1000n)).toBe(huge);
  });
});

describe('percentOf', () => {
  it('computes the README pool discounts', () => {
    expect(percentOf(2699n, 20)).toBe(540n); // 539.8 → 540
    expect(percentOf(2684n, 20)).toBe(537n); // 536.8 → 537
  });

  it('handles the boundaries', () => {
    expect(percentOf(4699n, 0)).toBe(0n);
    expect(percentOf(4699n, 100)).toBe(4699n);
  });

  it('rejects a percentage outside 0-100 or a fractional one', () => {
    expect(() => percentOf(100n, 101)).toThrow(RangeError);
    expect(() => percentOf(100n, -1)).toThrow(RangeError);
    expect(() => percentOf(100n, 12.5)).toThrow(RangeError);
  });
});

describe('formatPaisa', () => {
  it('always shows two decimal places', () => {
    expect(formatPaisa(4159n)).toBe('41.59');
    expect(formatPaisa(4100n)).toBe('41.00');
    expect(formatPaisa(4105n)).toBe('41.05'); // the leading zero matters
  });

  it('handles amounts below one Taka', () => {
    expect(formatPaisa(0n)).toBe('0.00');
    expect(formatPaisa(5n)).toBe('0.05');
    expect(formatPaisa(99n)).toBe('0.99');
  });

  it('handles negatives, which a wallet correction could produce', () => {
    expect(formatPaisa(-4159n)).toBe('-41.59');
    expect(formatPaisa(-5n)).toBe('-0.05');
  });

  it('appends the currency in formatTaka', () => {
    expect(formatTaka(8306n)).toBe('83.06 BDT');
  });

  it('does not lose precision on a large balance', () => {
    // Dividing by 100 in floating point is exactly what this avoids.
    expect(formatPaisa(123_456_789_012_345n)).toBe('1234567890123.45');
  });
});

describe('takaToPaisa', () => {
  it('parses a decimal string exactly', () => {
    // 41.59 * 100 in floating point is 4158.999999999999, which is the bug this
    // function exists to make impossible.
    expect(takaToPaisa('41.59')).toBe(4159n);
    expect(takaToPaisa('500')).toBe(50_000n);
    expect(takaToPaisa('0.05')).toBe(5n);
    expect(takaToPaisa('41.5')).toBe(4150n);
  });

  it('round-trips with formatPaisa', () => {
    for (const paisa of [0n, 1n, 99n, 4159n, 50_000n, 8306n]) {
      expect(takaToPaisa(formatPaisa(paisa))).toBe(paisa);
    }
  });

  it('handles negatives and surrounding whitespace', () => {
    expect(takaToPaisa('-41.59')).toBe(-4159n);
    expect(takaToPaisa('  41.59  ')).toBe(4159n);
  });

  it('rejects anything that is not a plain amount', () => {
    for (const bad of ['41.599', 'abc', '', '41,59', '4 1', '1e3', '.5']) {
      expect(() => takaToPaisa(bad)).toThrow(RangeError);
    }
  });
});

describe('kilometre conversion', () => {
  it('converts the stored DECIMAL(6,3) form to integer metres', () => {
    expect(kmToMilliKm('1.799')).toBe(1799);
    expect(kmToMilliKm('9.460')).toBe(9460);
    expect(kmToMilliKm('1.8')).toBe(1800);
    expect(kmToMilliKm('12')).toBe(12_000);
  });

  it('round-trips', () => {
    for (const metres of [1, 389, 1789, 1799, 9460, 12_000]) {
      expect(kmToMilliKm(milliKmToKm(metres))).toBe(metres);
    }
  });

  it('pads the fraction to three places, matching the column', () => {
    expect(milliKmToKm(1799)).toBe('1.799');
    expect(milliKmToKm(1800)).toBe('1.800');
    expect(milliKmToKm(5)).toBe('0.005');
    expect(milliKmToKm(0)).toBe('0.000');
  });

  it('rejects malformed input', () => {
    expect(() => kmToMilliKm('1.7994')).toThrow(RangeError);
    expect(() => kmToMilliKm('-1.5')).toThrow(RangeError);
    expect(() => milliKmToKm(-1)).toThrow(RangeError);
    expect(() => milliKmToKm(1.5)).toThrow(RangeError);
  });
});
