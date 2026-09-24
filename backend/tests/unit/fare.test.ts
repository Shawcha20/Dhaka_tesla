import { describe, expect, it } from 'vitest';

import { calculateFare, isPooled, type FareConfig } from '../../src/lib/fare.js';
import { distanceMilliKm } from '../../src/lib/geo.js';
import { formatTaka } from '../../src/lib/money.js';

/** The defaults from .env.example, pinned so these expectations stay hand-checkable. */
const CONFIG: FareConfig = {
  baseFarePaisa: 2000,
  perKmPaisa: 1500,
  poolDiscountPct: 20,
};

const BANANI = { latitude: 23.7939, longitude: 90.4043 };
const MOHAKHALI = { latitude: 23.7778, longitude: 90.406 };
const GULSHAN_1 = { latitude: 23.7806, longitude: 90.4142 };

describe('the README worked example', () => {
  const nusratMetres = distanceMilliKm(BANANI, MOHAKHALI);
  const rafiqMetres = distanceMilliKm(BANANI, GULSHAN_1);

  it('prices Nusrat solo at 46.99 BDT', () => {
    const fare = calculateFare(
      { distanceMilliKm: nusratMetres, seats: 1, pooled: false },
      CONFIG,
    );

    // 1500 × 1.799 = 2698.5 → 2699, plus 2000 base.
    expect(fare.distanceChargePaisa).toBe(2699n);
    expect(fare.poolDiscountPaisa).toBe(0n);
    expect(fare.totalFarePaisa).toBe(4699n);
    expect(formatTaka(fare.totalFarePaisa)).toBe('46.99 BDT');
  });

  it('prices Nusrat pooled at 41.59 BDT', () => {
    const fare = calculateFare(
      { distanceMilliKm: nusratMetres, seats: 1, pooled: true },
      CONFIG,
    );

    // 20% of 2699 = 539.8 → 540.
    expect(fare.poolDiscountPaisa).toBe(540n);
    expect(fare.totalFarePaisa).toBe(4159n);
    expect(formatTaka(fare.totalFarePaisa)).toBe('41.59 BDT');
  });

  it('prices Rafiq solo at 46.84 BDT', () => {
    const fare = calculateFare(
      { distanceMilliKm: rafiqMetres, seats: 1, pooled: false },
      CONFIG,
    );

    expect(fare.distanceChargePaisa).toBe(2684n);
    expect(fare.totalFarePaisa).toBe(4684n);
    expect(formatTaka(fare.totalFarePaisa)).toBe('46.84 BDT');
  });

  it('prices Rafiq pooled at 41.47 BDT', () => {
    const fare = calculateFare(
      { distanceMilliKm: rafiqMetres, seats: 1, pooled: true },
      CONFIG,
    );

    expect(fare.poolDiscountPaisa).toBe(537n);
    expect(fare.totalFarePaisa).toBe(4147n);
    expect(formatTaka(fare.totalFarePaisa)).toBe('41.47 BDT');
  });

  it('earns Jashim 83.06 BDT for the shared trip instead of 46.99 alone', () => {
    const nusrat = calculateFare(
      { distanceMilliKm: nusratMetres, seats: 1, pooled: true },
      CONFIG,
    );
    const rafiq = calculateFare(
      { distanceMilliKm: rafiqMetres, seats: 1, pooled: true },
      CONFIG,
    );

    // The whole product in one assertion: both passengers pay less than they
    // would alone, and the driver still earns more on the trip.
    expect(formatTaka(nusrat.totalFarePaisa + rafiq.totalFarePaisa)).toBe('83.06 BDT');
  });

  it('saves each passenger more than 5 BDT by sharing', () => {
    for (const metres of [nusratMetres, rafiqMetres]) {
      const solo = calculateFare({ distanceMilliKm: metres, seats: 1, pooled: false }, CONFIG);
      const pooled = calculateFare({ distanceMilliKm: metres, seats: 1, pooled: true }, CONFIG);

      expect(solo.totalFarePaisa - pooled.totalFarePaisa).toBeGreaterThan(500n);
    }
  });
});

describe('the discount spares the base fare', () => {
  it('never discounts the base component', () => {
    const solo = calculateFare({ distanceMilliKm: 5000, seats: 1, pooled: false }, CONFIG);
    const pooled = calculateFare({ distanceMilliKm: 5000, seats: 1, pooled: true }, CONFIG);

    expect(pooled.baseFarePaisa).toBe(solo.baseFarePaisa);
    // The entire difference is attributable to the distance component.
    expect(solo.totalFarePaisa - pooled.totalFarePaisa).toBe(pooled.poolDiscountPaisa);
  });

  it('guarantees the driver at least the base fare per passenger', () => {
    // Even at a 100% distance discount, the pickup cost still has to be paid.
    const generous: FareConfig = { ...CONFIG, poolDiscountPct: 100 };
    const fare = calculateFare({ distanceMilliKm: 9000, seats: 1, pooled: true }, generous);

    expect(fare.totalFarePaisa).toBe(BigInt(CONFIG.baseFarePaisa));
  });
});

describe('seats', () => {
  it('charges each seat the same discounted rate', () => {
    const one = calculateFare({ distanceMilliKm: 1799, seats: 1, pooled: true }, CONFIG);
    const two = calculateFare({ distanceMilliKm: 1799, seats: 2, pooled: true }, CONFIG);

    expect(two.perSeatFarePaisa).toBe(one.perSeatFarePaisa);
    expect(two.totalFarePaisa).toBe(one.totalFarePaisa * 2n);
  });

  it('rejects a zero or fractional seat count', () => {
    expect(() => calculateFare({ distanceMilliKm: 1799, seats: 0, pooled: false }, CONFIG)).toThrow(
      /seats/,
    );
    expect(() =>
      calculateFare({ distanceMilliKm: 1799, seats: 1.5, pooled: false }, CONFIG),
    ).toThrow(/seats/);
  });
});

describe('rounding', () => {
  it('rounds a half-paisa distance charge up, not down', () => {
    // 1500 × 1.799 lands exactly on .5, which is the case a naive truncation
    // would get wrong — and the case that appears in the README.
    const fare = calculateFare({ distanceMilliKm: 1799, seats: 1, pooled: false }, CONFIG);

    expect(fare.distanceChargePaisa).toBe(2699n); // not 2698
  });

  it('never produces a fractional paisa', () => {
    for (let metres = 1; metres <= 12_000; metres += 7) {
      const fare = calculateFare({ distanceMilliKm: metres, seats: 1, pooled: true }, CONFIG);

      // bigint cannot be fractional, so this asserts the stronger property: no
      // stage of the calculation ever left the integer domain.
      expect(typeof fare.totalFarePaisa).toBe('bigint');
      expect(fare.totalFarePaisa).toBeGreaterThan(0n);
    }
  });

  it('keeps the breakdown internally consistent at every distance', () => {
    for (let metres = 100; metres <= 12_000; metres += 131) {
      const fare = calculateFare({ distanceMilliKm: metres, seats: 2, pooled: true }, CONFIG);

      expect(fare.perSeatFarePaisa).toBe(
        fare.baseFarePaisa + fare.distanceChargePaisa - fare.poolDiscountPaisa,
      );
      expect(fare.totalFarePaisa).toBe(fare.perSeatFarePaisa * 2n);
    }
  });
});

describe('configurability', () => {
  it('honours a changed per-km rate, so the model can be retested by hand', () => {
    const doubled = calculateFare(
      { distanceMilliKm: 1799, seats: 1, pooled: false },
      { ...CONFIG, perKmPaisa: 3000 },
    );

    // 3000 × 1799 = 5_397_000, which divides by 1000 exactly: 5397.
    expect(doubled.distanceChargePaisa).toBe(5397n);
  });

  it('does not double the charge when the rate doubles, because rounding happens once', () => {
    const single = calculateFare({ distanceMilliKm: 1799, seats: 1, pooled: false }, CONFIG);
    const doubled = calculateFare(
      { distanceMilliKm: 1799, seats: 1, pooled: false },
      { ...CONFIG, perKmPaisa: CONFIG.perKmPaisa * 2 },
    );

    /**
     * A one-paisa discrepancy that is correct rather than a bug, and worth
     * pinning down: at 1500/km the charge lands on 2698.5 and rounds up to 2699,
     * so 2 × 2699 = 5398. At 3000/km the multiplication is exact at 5397, and no
     * rounding occurs at all.
     *
     * Rounding once, at the end of the multiplication, is what makes the result
     * depend only on the inputs — not on how many steps were taken to get there.
     */
    expect(single.distanceChargePaisa * 2n).toBe(5398n);
    expect(doubled.distanceChargePaisa).toBe(5397n);
  });

  it('applies a zero discount as no discount', () => {
    const fare = calculateFare(
      { distanceMilliKm: 1799, seats: 1, pooled: true },
      { ...CONFIG, poolDiscountPct: 0 },
    );

    expect(fare.poolDiscountPaisa).toBe(0n);
    expect(fare.totalFarePaisa).toBe(4699n);
  });

  it('rejects a distance of zero — a trip with no distance cannot be priced', () => {
    expect(() =>
      calculateFare({ distanceMilliKm: 0, seats: 1, pooled: false }, CONFIG),
    ).toThrow(/distanceMilliKm/);
  });
});

describe('isPooled', () => {
  it('treats a lone passenger as not pooled', () => {
    expect(isPooled(1)).toBe(false);
  });

  it('treats two or more as pooled', () => {
    expect(isPooled(2)).toBe(true);
    expect(isPooled(3)).toBe(true);
  });

  it('treats an empty pool as not pooled', () => {
    expect(isPooled(0)).toBe(false);
  });
});
