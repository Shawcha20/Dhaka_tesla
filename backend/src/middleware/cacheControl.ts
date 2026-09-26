import type { RequestHandler } from 'express';

/**
 * Marks every API response as uncacheable.
 *
 * Without an explicit directive, HTTP permits a cache to apply its own heuristic
 * and reuse a response it was never told it could. Every endpoint here is either
 * authenticated or live state, so there is no response worth reusing — and one
 * that is reused is actively wrong.
 *
 * This surfaced as a real bug: the driver's request feed polls every few seconds,
 * but the browser was free to serve its own cached copy, so a driver kept seeing
 * "nobody waiting" while passengers were in fact queued. The client had no way to
 * detect it, because the stale response arrived looking exactly like a fresh one.
 *
 * `no-store` rather than `no-cache`: no-cache still permits storing the response
 * and revalidating, which for an authenticated payload means it sits in a shared
 * cache or on disk. no-store forbids keeping it at all.
 *
 * `Vary: Cookie` is set alongside so that any cache which ignores no-store at
 * least cannot serve one user's response to another.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.vary('Cookie');
  next();
};
