import { Router } from 'express';

import { runReadinessChecks } from '../../lib/readiness.js';

export const healthRouter = Router();

/**
 * Liveness. Deliberately checks nothing external: if this returns 200 the
 * process is alive and able to serve. Making it depend on the database would
 * cause an orchestrator to restart a perfectly healthy container because MySQL
 * was briefly slow.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    data: {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
});

/**
 * Readiness. Returns 200 only when every registered dependency responds, so
 * Compose and Render can hold traffic back until the API can actually serve it.
 */
healthRouter.get('/ready', async (_req, res) => {
  const result = await runReadinessChecks();
  res.status(result.ok ? 200 : 503).json({
    data: {
      status: result.ok ? 'ready' : 'not_ready',
      checks: result.checks,
    },
  });
});
