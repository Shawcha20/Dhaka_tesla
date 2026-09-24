import type { Logger } from 'pino';

import { runShutdownHooks } from './shutdown.js';

/** The slice of `http.Server` we actually need, so tests can supply a fake. */
export interface ClosableServer {
  close(cb?: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownDeps {
  server: ClosableServer;
  logger: Pick<Logger, 'info' | 'error' | 'flush'>;
  graceMs: number;
  /** Injected so a test can assert the force path without killing the runner. */
  exit?: (code: number) => void;
}

/**
 * Extracted from `server.ts` for two reasons: the shutdown sequence is the part
 * most likely to be subtly wrong, and Windows does not deliver POSIX signals to
 * Node — so the only way to exercise this on a developer machine is to call it
 * directly.
 */
export function createShutdownHandler(deps: ShutdownDeps) {
  const { server, logger, graceMs, exit = (code) => process.exit(code) } = deps;
  let shuttingDown = false;

  return async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (shuttingDown) {
      logger.info({ reason }, 'shutdown already in progress, ignoring');
      return;
    }
    shuttingDown = true;
    logger.info({ reason }, 'shutting down');

    // Hard deadline. If a request hangs, the container must still exit, or the
    // orchestrator eventually kills it less politely.
    const forceExit = setTimeout(() => {
      logger.error({ reason }, `did not finish within ${graceMs}ms, forcing exit`);
      server.closeAllConnections?.();
      logger.flush();
      exit(1);
    }, graceMs);
    forceExit.unref();

    // Stop accepting new connections, then drain idle keep-alive sockets.
    // In-flight requests are left alone so they can finish.
    server.close();
    server.closeIdleConnections?.();

    await runShutdownHooks();

    clearTimeout(forceExit);
    logger.info('shutdown complete');

    /**
     * Deliberately no `process.exit()` on the happy path. Pino writes through a
     * worker thread, and an immediate exit discards whatever it has buffered —
     * losing precisely the lines that explain why the process went down. Setting
     * an exit code and letting the event loop drain flushes the transport first.
     */
    process.exitCode = exitCode;
    logger.flush();
  };
}
