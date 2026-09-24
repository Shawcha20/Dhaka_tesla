import { PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';
import { logger } from './logger.js';
import { onShutdown } from './shutdown.js';

/**
 * Prisma's own log output goes to stdout unstructured by default, which would sit
 * alongside our JSON lines and defeat log aggregation. Emitting events instead
 * lets everything go through pino with the same shape and the same redaction.
 */
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('warn', (e) => {
  logger.warn({ target: e.target }, e.message);
});

prisma.$on('error', (e) => {
  logger.error({ target: e.target }, e.message);
});

// Registered only when it could actually be emitted — at info level this handler
// would allocate a log object per query and immediately discard it.
if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace') {
  prisma.$on('query', (e) => {
    logger.debug(
      { query: e.query, params: e.params, durationMs: e.duration },
      'prisma query',
    );
  });
}

// The pool must be released before the process exits, or a redeploy leaves
// connections lingering on the database until they time out.
onShutdown('prisma', async () => {
  await prisma.$disconnect();
});

/**
 * The readiness probe. Deliberately the cheapest possible round trip: this needs
 * to answer "can I reach the database" without adding load to a database that
 * may already be struggling.
 */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
