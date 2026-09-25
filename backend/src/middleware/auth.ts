import type { RequestHandler } from 'express';

import type { Role } from '../domain/auth.js';
import { extractAccessToken } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';

/**
 * Verifies the access token and attaches `req.user`.
 *
 * Deliberately does **not** hit the database. That is the trade an access token
 * buys: a signature check is enough to know who is calling, and the short TTL
 * bounds how long a stale claim can survive. A route that needs to know the
 * account is still active uses `requireActiveUser` below.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = extractAccessToken(req);
  if (!token) {
    next(new AppError('UNAUTHENTICATED'));
    return;
  }

  // verifyAccessToken throws AppError for expired vs malformed, which the error
  // handler turns into TOKEN_EXPIRED or UNAUTHENTICATED respectively — the client
  // needs to tell those apart to know whether refreshing is worth attempting.
  req.user = verifyAccessToken(token);
  next();
};

/**
 * Role gate. Curried so routes read as `requireRole('DRIVER')`.
 *
 * Returns 403 rather than 404 because the resource is not the issue — the caller
 * is authenticated and simply may not act in this capacity.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError('UNAUTHENTICATED'));
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(
        new AppError('FORBIDDEN_ROLE', {
          context: { required: allowed, actual: req.user.role },
        }),
      );
      return;
    }
    next();
  };
}

/**
 * Confirms the account still exists and is enabled, at the cost of one query.
 *
 * Used only where acting on a stale token would have lasting consequences —
 * creating a ride, accepting a pool, settling money — rather than on every read.
 * A disabled account with an unexpired token can still see its own history; it
 * cannot commit anyone to anything new.
 */
export const requireActiveUser: RequestHandler = async (req, _res, next) => {
  if (!req.user) {
    next(new AppError('UNAUTHENTICATED'));
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, isActive: true, role: true },
  });

  if (!user) {
    // The token is validly signed but names someone who no longer exists.
    next(new AppError('UNAUTHENTICATED', { message: 'Account no longer exists.' }));
    return;
  }
  if (!user.isActive) {
    next(new AppError('ACCOUNT_DISABLED'));
    return;
  }
  if (user.role !== req.user.role) {
    // Role changed since the token was issued; force a refresh rather than
    // honouring a claim the database disagrees with.
    next(new AppError('UNAUTHENTICATED', { message: 'Please sign in again.' }));
    return;
  }

  next();
};
