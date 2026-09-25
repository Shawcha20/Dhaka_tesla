import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import type { AuthUser, Role } from '../domain/auth.js';
import { AppError } from './errors.js';

const ISSUER = 'dhaka-tesla-pool';

/**
 * Access tokens are JWTs; refresh tokens are not.
 *
 * An access token is verified on nearly every request, including a polled status
 * endpoint, so a signature check with no database round trip is the right trade.
 * The cost is that it cannot be revoked before it expires — hence the short TTL.
 *
 * A refresh token is the opposite: used rarely, and revocation has to actually
 * work when someone logs out. So it is an opaque 256-bit random value whose
 * validity is decided by a database row rather than by a signature. Opaque means
 * unforgeable by construction — there is no algebra to attack, only a lookup that
 * either finds a live row or does not.
 */

interface AccessClaims {
  sub: string;
  email: string;
  role: Role;
}

export function signAccessToken(user: {
  id: bigint;
  email: string;
  role: Role;
}): string {
  const claims: AccessClaims = {
    sub: user.id.toString(),
    email: user.email,
    role: user.role,
  };

  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: ISSUER,
  });
}

/**
 * Throws `TOKEN_EXPIRED` or `UNAUTHENTICATED` — never returns null. A caller that
 * forgets to check a nullable result would silently treat an invalid token as an
 * anonymous request; throwing makes that impossible.
 */
export function verifyAccessToken(token: string): AuthUser {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER });
  } catch (e) {
    if (e instanceof Error && e.name === 'TokenExpiredError') {
      throw new AppError('TOKEN_EXPIRED', { cause: e });
    }
    throw new AppError('UNAUTHENTICATED', { cause: e });
  }

  // jwt.verify returns `string | JwtPayload`, and a payload whose shape we have
  // not checked. Validate before trusting any of it.
  if (typeof decoded !== 'object' || decoded === null) {
    throw new AppError('UNAUTHENTICATED', { message: 'Malformed token payload.' });
  }

  const { sub, email, role } = decoded as Partial<AccessClaims>;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new AppError('UNAUTHENTICATED', { message: 'Malformed token payload.' });
  }
  if (role !== 'PASSENGER' && role !== 'DRIVER') {
    throw new AppError('UNAUTHENTICATED', { message: 'Unknown role in token.' });
  }

  let id: bigint;
  try {
    id = BigInt(sub);
  } catch {
    throw new AppError('UNAUTHENTICATED', { message: 'Malformed subject in token.' });
  }
  if (id <= 0n) {
    throw new AppError('UNAUTHENTICATED', { message: 'Malformed subject in token.' });
  }

  return { id, email, role };
}

export interface GeneratedRefreshToken {
  /** Sent to the client. Never stored. */
  token: string;
  /** Stored. Never sent. */
  tokenHash: string;
  expiresAt: Date;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  // 256 bits of entropy: not guessable, so the stored digest needs no salt or
  // slow KDF the way a low-entropy password would.
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + parseDuration(env.REFRESH_TOKEN_TTL)),
  };
}

/**
 * HMAC rather than a bare SHA-256.
 *
 * Both are irreversible for a 256-bit random input, but keying the digest means a
 * stolen database is not by itself enough to validate a captured token — the
 * attacker also needs the secret, which lives in the environment rather than in
 * the data. It is also the justification for keeping two distinct secrets: the
 * access signing key and this one have independent blast radius.
 */
export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

/**
 * Constant-time comparison, for the rare paths that compare digests directly.
 * Lookups go through a unique index instead, but where a comparison is done in
 * application code it should not leak position information through timing.
 */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Parses the `15m` / `7d` forms used in configuration into milliseconds.
 *
 * Hand-rolled rather than pulling in `ms`: the grammar is four suffixes, and a
 * dependency for that is not worth the supply-chain surface.
 */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new RangeError(
      `invalid duration "${value}" — expected a number followed by s, m, h or d`,
    );
  }
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * multiplier;
}
