import { describe, expect, it } from 'vitest';

import { jsonReplacer } from '../../src/lib/json.js';

/** Mirrors how Express applies the replacer inside res.json. */
const serialize = (value: unknown): string => JSON.stringify(value, jsonReplacer);

describe('jsonReplacer', () => {
  it('serialises bigint ids and money as JSON numbers', () => {
    const payload = { id: 11n, estimatedFarePaisa: 4699n, finalFarePaisa: 4159n };

    expect(serialize(payload)).toBe(
      '{"id":11,"estimatedFarePaisa":4699,"finalFarePaisa":4159}',
    );
  });

  it('reaches bigints nested in objects and arrays', () => {
    const payload = {
      pool: { id: 1n, seatsTaken: 2 },
      members: [{ farePaisa: 4159n }, { farePaisa: 4147n }],
    };

    expect(JSON.parse(serialize(payload))).toEqual({
      pool: { id: 1, seatsTaken: 2 },
      members: [{ farePaisa: 4159 }, { farePaisa: 4147 }],
    });
  });

  it('leaves every other type untouched', () => {
    const payload = {
      name: 'Nusrat',
      seats: 1,
      pooled: true,
      cancelledAt: null,
      // Prisma returns Decimal, whose own toJSON emits a string — which is why
      // distances and coordinates arrive as strings, not numbers.
      distanceKm: '1.799',
    };

    expect(JSON.parse(serialize(payload))).toEqual(payload);
  });

  it('throws rather than silently rounding a bigint beyond the safe range', () => {
    const tooLarge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    // Rounding money or an id without complaint is a far worse failure than a
    // 500, so the guard is deliberately loud.
    expect(() => serialize({ id: tooLarge })).toThrow(/without losing precision/);
  });

  it('accepts a bigint exactly at the safe boundary', () => {
    const atLimit = BigInt(Number.MAX_SAFE_INTEGER);

    expect(serialize({ id: atLimit })).toBe(`{"id":${Number.MAX_SAFE_INTEGER}}`);
  });

  it('handles negative bigints, which a wallet correction could produce', () => {
    expect(serialize({ delta: -500n })).toBe('{"delta":-500}');
  });
});
