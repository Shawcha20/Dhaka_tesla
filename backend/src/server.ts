import { createApp } from './app.js';
import { env } from './config/env.js';
import { createShutdownHandler } from './lib/gracefulShutdown.js';
import { logger } from './lib/logger.js';
import { pingDatabase } from './lib/prisma.js';
import { registerReadinessCheck } from './lib/readiness.js';

/** How long to let in-flight requests finish before exiting anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

/**
 * Registered here rather than inside the Prisma module so that importing the
 * client does not, as a side effect, make every test's `/ready` call try to open
 * a database connection.
 */
registerReadinessCheck({ name: 'database', probe: pingDatabase });

const app = createApp();

const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT },
    `API listening on :${env.API_PORT}`,
  );
});

/**
 * Must exceed the load balancer's idle timeout. Otherwise the proxy can reuse a
 * connection at the moment Node decides to close it, which surfaces as sporadic
 * 502s that are miserable to diagnose.
 */
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

const shutdown = createShutdownHandler({
  server,
  logger,
  graceMs: SHUTDOWN_GRACE_MS,
});

// SIGTERM is what Docker and Render send. SIGINT is Ctrl-C.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * An unhandled rejection or uncaught exception means state is now unknown. Log it
 * and exit rather than serving further requests from a process we can no longer
 * reason about — the orchestrator will start a clean one.
 */
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});
