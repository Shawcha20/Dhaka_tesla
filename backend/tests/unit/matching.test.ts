import { describe, expect, it } from 'vitest';

import {
  areRoutesCompatible,
  evaluatePoolability,
  type MatchingConfig,
  type PoolSnapshot,
  type RideCandidate,
} from '../../src/domain/matching.js';
import { initialBearingDeg } from '../../src/lib/geo.js';

const CONFIG: MatchingConfig = { maxBearingDiffDeg: 45 };

const BANANI = { latitude: 23.7939, longitude: 90.4043 };
const MOHAKHALI = { latitude: 23.7778, longitude: 90.406 };
const GULSHAN_1 = { latitude: 23.7806, longitude: 90.4142 };
const UTTARA = { latitude: 23.8759, longitude: 90.3795 };

const BANANI_AREA_ID = 1;
const DHANMONDI_AREA_ID = 5;

const NUSRAT_BEARING = initialBearingDeg(BANANI, MOHAKHALI); // 174.5
const RAFIQ_BEARING = initialBearingDeg(BANANI, GULSHAN_1); // 145.7
const UTTARA_BEARING = initialBearingDeg(BANANI, UTTARA); // 344.5

/** Bullet, mid-formation with Nusrat aboard: 1 of 3 seats taken. */
function bulletWithNusrat(overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    status: 'FORMING',
    pickupAreaId: BANANI_AREA_ID,
    capacity: 3,
    seatsTaken: 1,
    memberBearingsDeg: [NUSRAT_BEARING],
    ...overrides,
  };
}

const rafiq: RideCandidate = {
  pickupAreaId: BANANI_AREA_ID,
  seats: 1,
  bearingDeg: RAFIQ_BEARING,
};

describe('the brief\'s scenario', () => {
  it('lets Rafiq join Nusrat, reporting the 28.7 degree difference', () => {
    const result = evaluatePoolability(bulletWithNusrat(), rafiq, CONFIG);

    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.bearingDiffDeg).toBeCloseTo(28.7, 1);
    expect(result.freeSeats).toBe(2);
  });

  it('refuses a Banani to Uttara request as the wrong direction', () => {
    const result = evaluatePoolability(
      bulletWithNusrat(),
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: UTTARA_BEARING },
      CONFIG,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ROUTE_NOT_COMPATIBLE');
    // Reported so the driver sees *why*, rather than the request just vanishing.
    expect(result.bearingDiffDeg).toBeCloseTo(170.1, 1);
  });

  it('refuses Shirin when she wants two seats and only one remains', () => {
    const result = evaluatePoolability(
      bulletWithNusrat({ seatsTaken: 2, memberBearingsDeg: [NUSRAT_BEARING, RAFIQ_BEARING] }),
      { pickupAreaId: BANANI_AREA_ID, seats: 2, bearingDeg: RAFIQ_BEARING },
      CONFIG,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('NOT_ENOUGH_SEATS');
    expect(result.freeSeats).toBe(1);
  });

  it('lets Shirin take the last single seat', () => {
    const result = evaluatePoolability(
      bulletWithNusrat({ seatsTaken: 2, memberBearingsDeg: [NUSRAT_BEARING, RAFIQ_BEARING] }),
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: RAFIQ_BEARING },
      CONFIG,
    );

    expect(result.eligible).toBe(true);
    expect(result.freeSeats).toBe(1);
  });
});

describe('pickup area', () => {
  it('refuses a different pickup area however compatible the direction', () => {
    const result = evaluatePoolability(
      bulletWithNusrat(),
      { pickupAreaId: DHANMONDI_AREA_ID, seats: 1, bearingDeg: NUSRAT_BEARING },
      CONFIG,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('DIFFERENT_PICKUP_AREA');
  });
});

describe('pool status', () => {
  it.each(['DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const)(
    'refuses new members once the pool is %s',
    (status) => {
      const result = evaluatePoolability(bulletWithNusrat({ status }), rafiq, CONFIG);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('POOL_NOT_FORMING');
    },
  );

  it('reports POOL_NOT_FORMING ahead of any other failure', () => {
    // A departed Tesla is the decisive fact — the driver does not need to hear
    // about seats or bearings.
    const result = evaluatePoolability(
      bulletWithNusrat({ status: 'STARTED', seatsTaken: 3 }),
      { pickupAreaId: DHANMONDI_AREA_ID, seats: 3, bearingDeg: UTTARA_BEARING },
      CONFIG,
    );

    expect(result.reason).toBe('POOL_NOT_FORMING');
  });
});

describe('transitive drift', () => {
  it('rejects a candidate compatible with one member but not another', () => {
    /**
     * This is the case that makes "compare against every member" necessary.
     * A at 0 degrees and B at 40 are within 45. C at 80 is within 45 of B, but
     * 80 degrees from A — so C must not be allowed in, even though a naive
     * check against only the most recent member would permit it.
     */
    const pool = bulletWithNusrat({ memberBearingsDeg: [0, 40] });
    const result = evaluatePoolability(
      pool,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: 80 },
      CONFIG,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ROUTE_NOT_COMPATIBLE');
    expect(result.bearingDiffDeg).toBe(80); // the worst case, not the best
  });

  it('accepts a candidate within range of every member', () => {
    const pool = bulletWithNusrat({ memberBearingsDeg: [0, 40] });
    const result = evaluatePoolability(
      pool,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: 20 },
      CONFIG,
    );

    expect(result.eligible).toBe(true);
    expect(result.bearingDiffDeg).toBe(20);
  });
});

describe('threshold behaviour', () => {
  it('accepts a difference exactly at the threshold', () => {
    const pool = bulletWithNusrat({ memberBearingsDeg: [0] });
    const result = evaluatePoolability(
      pool,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: 45 },
      CONFIG,
    );

    expect(result.eligible).toBe(true);
  });

  it('rejects a difference just past the threshold', () => {
    const pool = bulletWithNusrat({ memberBearingsDeg: [0] });
    const result = evaluatePoolability(
      pool,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: 45.5 },
      CONFIG,
    );

    expect(result.eligible).toBe(false);
  });

  it('compares full precision, not the rounded display value', () => {
    // 45.04 rounds to 45.0 for display but must still be rejected — rounding
    // before comparing would quietly widen the rule.
    const pool = bulletWithNusrat({ memberBearingsDeg: [0] });
    const result = evaluatePoolability(
      pool,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: 45.04 },
      CONFIG,
    );

    expect(result.eligible).toBe(false);
    expect(result.bearingDiffDeg).toBe(45); // display rounds, the decision did not
  });

  it('handles the wrap across north', () => {
    const pool = bulletWithNusrat({ memberBearingsDeg: [350] });
    const result = evaluatePoolability(
      pool,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: 10 },
      CONFIG,
    );

    expect(result.eligible).toBe(true);
    expect(result.bearingDiffDeg).toBe(20);
  });

  it('honours a configured threshold', () => {
    const pool = bulletWithNusrat({ memberBearingsDeg: [NUSRAT_BEARING] });
    const strict: MatchingConfig = { maxBearingDiffDeg: 20 };

    // Nusrat and Rafiq are 28.7 apart, so a 20 degree rule separates them.
    expect(evaluatePoolability(pool, rafiq, strict).eligible).toBe(false);
    expect(evaluatePoolability(pool, rafiq, CONFIG).eligible).toBe(true);
  });
});

describe('an empty pool', () => {
  it('accepts any direction when there is nobody to be compatible with', () => {
    const empty = bulletWithNusrat({ seatsTaken: 0, memberBearingsDeg: [] });
    const result = evaluatePoolability(
      empty,
      { pickupAreaId: BANANI_AREA_ID, seats: 1, bearingDeg: UTTARA_BEARING },
      CONFIG,
    );

    expect(result.eligible).toBe(true);
    expect(result.bearingDiffDeg).toBeNull();
    expect(result.freeSeats).toBe(3);
  });
});

describe('areRoutesCompatible', () => {
  it('agrees with the brief\'s example', () => {
    expect(areRoutesCompatible(NUSRAT_BEARING, RAFIQ_BEARING, CONFIG)).toBe(true);
    expect(areRoutesCompatible(NUSRAT_BEARING, UTTARA_BEARING, CONFIG)).toBe(false);
  });

  it('is symmetric', () => {
    expect(areRoutesCompatible(10, 350, CONFIG)).toBe(
      areRoutesCompatible(350, 10, CONFIG),
    );
  });
});
