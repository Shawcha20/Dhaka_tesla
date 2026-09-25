import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { env } from '../../src/config/env.js';
import { AppError } from '../../src/lib/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  parseDuration,
  safeCompareHex,
  signAccessToken,
  verifyAccessToken,
} from '../../src/lib/tokens.js';

const NUSRAT = {
  id: 2n,
  email: 'nusrat@dhakatesla.test',
  role: 'PASSENGER' as const,
};

describe('access tokens', () => {
  it('round-trips a user', () => {
    const user = verifyAccessToken(signAccessToken(NUSRAT));

    expect(user).toEqual(NUSRAT);
    // bigint, not number — it has to be usable directly as a Prisma key.
    expect(typeof user.id).toBe('bigint');
  });

  it('carries the role, so requireRole needs no database', () => {
    const jashim = { id: 1n, email: 'jashim@dhakatesla.test', role: 'DRIVER' as const };

    expect(verifyAccessToken(signAccessToken(jashim)).role).toBe('DRIVER');
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ sub: '2', email: NUSRAT.email, role: 'PASSENGER' }, 'not-the-secret', {
      issuer: 'dhaka-tesla-pool',
    });

    expect(() => verifyAccessToken(forged)).toThrow(AppError);
    expect(() => verifyAccessToken(forged)).toThrow(/Authentication is required/);
  });

  it('distinguishes an expired token from an invalid one', () => {
    // The client needs to tell these apart: expired means "try refreshing",
    // invalid means "sign in again".
    const expired = jwt.sign(
      { sub: '2', email: NUSRAT.email, role: 'PASSENGER' },
      env.JWT_ACCESS_SECRET,
      { issuer: 'dhaka-tesla-pool', expiresIn: '-1s' },
    );

    try {
      verifyAccessToken(expired);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects a token from another issuer', () => {
    const wrongIssuer = jwt.sign(
      { sub: '2', email: NUSRAT.email, role: 'PASSENGER' },
      env.JWT_ACCESS_SECRET,
      { issuer: 'somewhere-else' },
    );

    expect(() => verifyAccessToken(wrongIssuer)).toThrow(AppError);
  });

  it.each([
    ['a role that does not exist', { sub: '2', email: 'a@b.test', role: 'ADMIN' }],
    ['no role at all', { sub: '2', email: 'a@b.test' }],
    ['no email', { sub: '2', role: 'PASSENGER' }],
    ['a non-numeric subject', { sub: 'abc', email: 'a@b.test', role: 'PASSENGER' }],
    ['a zero subject', { sub: '0', email: 'a@b.test', role: 'PASSENGER' }],
    ['a negative subject', { sub: '-5', email: 'a@b.test', role: 'PASSENGER' }],
  ])('rejects a validly signed token with %s', (_label, claims) => {
    // Correctly signed but semantically wrong: a signature proves origin, not
    // that the payload is a shape we should trust.
    const token = jwt.sign(claims, env.JWT_ACCESS_SECRET, { issuer: 'dhaka-tesla-pool' });

    expect(() => verifyAccessToken(token)).toThrow(AppError);
  });

  it('rejects an outright malformed string', () => {
    for (const bad of ['', 'not.a.token', 'aaa', '...']) {
      expect(() => verifyAccessToken(bad)).toThrow(AppError);
    }
  });
});

describe('refresh tokens', () => {
  it('produces high-entropy opaque tokens', () => {
    const { token } = generateRefreshToken();

    // 32 random bytes as base64url is 43 characters, no padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefreshToken().token));

    expect(tokens.size).toBe(200);
  });

  it('stores an HMAC, not the token itself', () => {
    const { token, tokenHash } = generateRefreshToken();

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // fits CHAR(64)
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toBe(hashRefreshToken(token));
  });

  it('hashes deterministically, so the unique index can do the lookup', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
  });

  it('expires in line with the configured TTL', () => {
    const before = Date.now();
    const { expiresAt } = generateRefreshToken();

    const expected = before + parseDuration(env.REFRESH_TOKEN_TTL);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expected - 50);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expected + 2_000);
  });
});

describe('safeCompareHex', () => {
  it('matches identical digests', () => {
    const { tokenHash } = generateRefreshToken();

    expect(safeCompareHex(tokenHash, tokenHash)).toBe(true);
  });

  it('rejects different digests and mismatched lengths', () => {
    expect(safeCompareHex(hashRefreshToken('a'), hashRefreshToken('b'))).toBe(false);
    expect(safeCompareHex('abcd', 'abcdef')).toBe(false);
  });
});

describe('parseDuration', () => {
  it('parses each supported unit', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('7d')).toBe(604_800_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDuration(' 15m ')).toBe(900_000);
  });

  it('rejects anything it does not understand rather than guessing', () => {
    for (const bad of ['', '15', 'm', '15w', '1.5h', '-5m', 'fifteen minutes']) {
      expect(() => parseDuration(bad)).toThrow(RangeError);
    }
  });

  it('agrees with the configured defaults', () => {
    expect(parseDuration(env.ACCESS_TOKEN_TTL)).toBeGreaterThan(0);
    expect(parseDuration(env.REFRESH_TOKEN_TTL)).toBeGreaterThan(
      parseDuration(env.ACCESS_TOKEN_TTL),
    );
  });
});
