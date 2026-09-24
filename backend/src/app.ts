import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { jsonReplacer } from './lib/json.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { healthRouter } from './modules/health/health.routes.js';
import { apiRouter } from './routes.js';

/**
 * Built as a factory rather than a module-level singleton so tests can create an
 * app and drive it with Supertest without ever opening a port.
 */
export function createApp(): Express {
  const app = express();

  // Render terminates TLS at its proxy; without this, every client looks like
  // the proxy and rate limiting becomes global instead of per-client.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.disable('etag');

  // Ids and money are BIGINT, which JSON.stringify refuses to serialise.
  // Scoped to res.json rather than patching BigInt.prototype globally.
  app.set('json replacer', jsonReplacer);

  // First, so every later log line and error response carries a request id.
  app.use(requestContext);

  app.use(
    helmet({
      // The API serves JSON only; a CSP here protects nothing and complicates
      // the frontend's own policy.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 86_400,
    }),
  );

  // 100kb is far more than any request here needs; the cap exists so a large
  // body cannot be used to exhaust memory before validation ever runs.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(globalLimiter);

  // Health lives outside /api/v1: probes should not have to track API versions.
  app.use(healthRouter);

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
