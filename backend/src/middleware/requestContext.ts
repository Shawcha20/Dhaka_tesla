import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { logger } from '../lib/logger.js';

/**
 * An inbound id is accepted so a trace can span frontend and API, but it is
 * validated first: an unchecked header value goes straight into log output, and
 * newlines in log output are how log injection works.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Paths that would otherwise flood the logs with health-check noise. */
const QUIET_PATHS = new Set(['/health', '/ready', '/api/v1/health', '/api/v1/ready']);

export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.get('x-request-id');
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('x-request-id', req.id);
  req.log = logger.child({ requestId: req.id });

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const quiet = QUIET_PATHS.has(req.path) && res.statusCode < 400;
    const level =
      res.statusCode >= 500
        ? 'error'
        : res.statusCode >= 400
          ? 'warn'
          : quiet
            ? 'debug'
            : 'info';

    req.log[level](
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userId: req.user?.id,
        role: req.user?.role,
        ip: req.ip,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode}`,
    );
  });

  next();
};
