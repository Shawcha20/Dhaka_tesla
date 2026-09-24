import rateLimit, { type Options } from 'express-rate-limit';

import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Route the rejection through our error handler so the body matches every
  // other error response instead of express-rate-limit's default text.
  handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  // Rate limiting in tests turns an ordinary suite into a flaky one.
  skip: () => env.isTest,
};

/** Broad protection against a single client hammering the API. */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  ...shared,
});

/**
 * Credential endpoints get a far tighter budget, counted per IP.
 * `skipSuccessfulRequests` means a legitimate user signing in repeatedly is not
 * punished — only failures accumulate, which is what throttles guessing.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  ...shared,
});

/** Ride creation is cheap to call and expensive to serve. */
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  ...shared,
});
