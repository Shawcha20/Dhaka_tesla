import { describe, expect, it } from 'vitest';

import {
  angularDifferenceDeg,
  distanceMilliKm,
  haversineKm,
  initialBearingDeg,
  type Coordinates,
} from '../../src/lib/geo.js';

/** The seeded coordinates, so these tests check the values the app actually uses. */
const AREAS = {
  Banani: { latitude: 23.7939, longitude: 90.4043 },
  'Gulshan 1': { latitude: 23.7806, longitude: 90.4142 },
  Mohakhali: { latitude: 23.7778, longitude: 90.406 },
  Uttara: { latitude: 23.8759, longitude: 90.3795 },
  Dhanmondi: { latitude: 23.7461, longitude: 90.3742 },
} satisfies Record<string, Coordinates>;

describe('haversineKm', () => {
  it('is zero for a point to itself', () => {
    expect(haversineKm(AREAS.Banani, AREAS.Banani)).toBe(0);
  });

  it('is symmetric', () => {
    const there = haversineKm(AREAS.Banani, AREAS.Mohakhali);
    const back = haversineKm(AREAS.Mohakhali, AREAS.Banani);

    expect(there).toBeCloseTo(back, 10);
  });

  it('reproduces the distances documented in the README', () => {
    // These two numbers appear in the fare worked example, so an evaluator can
    // recompute them by hand. If this test fails, the README is now wrong.
    expect(distanceMilliKm(AREAS.Banani, AREAS.Mohakhali)).toBe(1799);
    expect(distanceMilliKm(AREAS['Gulshan 1'], AREAS.Banani)).toBe(1789);
  });

  it('scales sensibly over a longer city hop', () => {
    // Banani to Uttara is a well-known ~9-10km run up the airport road.
    const km = haversineKm(AREAS.Banani, AREAS.Uttara);

    expect(km).toBeGreaterThan(9);
    expect(km).toBeLessThan(10);
  });
});

describe('initialBearingDeg', () => {
  it('reproduces the bearings documented in the README', () => {
    expect(initialBearingDeg(AREAS.Banani, AREAS.Mohakhali)).toBeCloseTo(174.5, 1);
    expect(initialBearingDeg(AREAS.Banani, AREAS['Gulshan 1'])).toBeCloseTo(145.7, 1);
    expect(initialBearingDeg(AREAS.Banani, AREAS.Uttara)).toBeCloseTo(344.5, 1);
  });

  it('returns roughly north for a due-north move', () => {
    const bearing = initialBearingDeg(
      { latitude: 23.78, longitude: 90.4 },
      { latitude: 23.88, longitude: 90.4 },
    );

    expect(bearing).toBeCloseTo(0, 5);
  });

  it('returns roughly east for a due-east move', () => {
    const bearing = initialBearingDeg(
      { latitude: 23.78, longitude: 90.4 },
      { latitude: 23.78, longitude: 90.5 },
    );

    expect(bearing).toBeCloseTo(90, 1);
  });

  it('always falls within [0, 360)', () => {
    for (const from of Object.values(AREAS)) {
      for (const to of Object.values(AREAS)) {
        if (from === to) continue;
        const bearing = initialBearingDeg(from, to);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
      }
    }
  });

  it('reverses by roughly 180 degrees', () => {
    const out = initialBearingDeg(AREAS.Banani, AREAS.Dhanmondi);
    const back = initialBearingDeg(AREAS.Dhanmondi, AREAS.Banani);

    // Not exactly 180 on a sphere — great-circle bearings converge — but close
    // over city distances.
    expect(angularDifferenceDeg(out, back)).toBeGreaterThan(179);
  });
});

describe('angularDifferenceDeg', () => {
  it('handles the wrap-around across north', () => {
    // The case that matters: without wrap handling this would be 340, and every
    // northbound pair straddling 0 would be wrongly rejected.
    expect(angularDifferenceDeg(350, 10)).toBe(20);
    expect(angularDifferenceDeg(10, 350)).toBe(20);
  });

  it('never exceeds 180', () => {
    for (let a = 0; a < 360; a += 17) {
      for (let b = 0; b < 360; b += 13) {
        const diff = angularDifferenceDeg(a, b);
        expect(diff).toBeGreaterThanOrEqual(0);
        expect(diff).toBeLessThanOrEqual(180);
      }
    }
  });

  it('is symmetric', () => {
    expect(angularDifferenceDeg(174.5, 145.7)).toBeCloseTo(
      angularDifferenceDeg(145.7, 174.5),
      10,
    );
  });

  it('gives 180 for exact opposites', () => {
    expect(angularDifferenceDeg(0, 180)).toBe(180);
    expect(angularDifferenceDeg(90, 270)).toBe(180);
  });
});

describe('the brief\'s matching example, end to end', () => {
  it('puts Nusrat and Rafiq 28.7 degrees apart', () => {
    const nusrat = initialBearingDeg(AREAS.Banani, AREAS.Mohakhali);
    const rafiq = initialBearingDeg(AREAS.Banani, AREAS['Gulshan 1']);

    // The headline number in the README. Comfortably inside the 45 degree rule.
    expect(angularDifferenceDeg(nusrat, rafiq)).toBeCloseTo(28.7, 1);
  });

  it('puts Banani to Uttara 170.1 degrees from Nusrat, the counter-example', () => {
    const nusrat = initialBearingDeg(AREAS.Banani, AREAS.Mohakhali);
    const uttara = initialBearingDeg(AREAS.Banani, AREAS.Uttara);

    expect(angularDifferenceDeg(nusrat, uttara)).toBeCloseTo(170.1, 1);
  });
});
