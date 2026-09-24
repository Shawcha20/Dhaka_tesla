import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createShutdownHandler,
  type ClosableServer,
} from '../../src/lib/gracefulShutdown.js';
import { clearShutdownHooks, onShutdown } from '../../src/lib/shutdown.js';

function fakeLogger() {
  return { info: vi.fn(), error: vi.fn(), flush: vi.fn() };
}

function fakeServer(): ClosableServer & {
  close: ReturnType<typeof vi.fn>;
  closeIdleConnections: ReturnType<typeof vi.fn>;
  closeAllConnections: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
}

describe('graceful shutdown', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    // The hook registry is module-level, so it would otherwise leak between cases.
    clearShutdownHooks();
  });

  afterEach(() => {
    clearShutdownHooks();
    process.exitCode = originalExitCode;
  });

  it('stops accepting connections and drains idle sockets', async () => {
    const server = fakeServer();
    const shutdown = createShutdownHandler({
      server,
      logger: fakeLogger(),
      graceMs: 1_000,
    });

    await shutdown('SIGTERM');

    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    // In-flight requests must be allowed to finish, so this must NOT be called
    // on the graceful path.
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it('runs registered shutdown hooks', async () => {
    const order: string[] = [];
    onShutdown('first', () => void order.push('first'));
    onShutdown('second', () => void order.push('second'));

    const shutdown = createShutdownHandler({
      server: fakeServer(),
      logger: fakeLogger(),
      graceMs: 1_000,
    });

    await shutdown('SIGTERM');

    // Reverse registration order, like a stack of defers: whatever was set up
    // last is torn down first.
    expect(order).toEqual(['second', 'first']);
  });

  it('keeps tearing down after a hook throws', async () => {
    const survivor = vi.fn();
    onShutdown('explodes', () => {
      throw new Error('boom');
    });
    onShutdown('survivor', survivor);

    const logger = fakeLogger();
    const shutdown = createShutdownHandler({
      server: fakeServer(),
      logger,
      graceMs: 1_000,
    });

    await expect(shutdown('SIGTERM')).resolves.toBeUndefined();
    expect(survivor).toHaveBeenCalledOnce();
  });

  it('sets an exit code instead of calling process.exit, so logs can flush', async () => {
    const exit = vi.fn();
    const logger = fakeLogger();
    const shutdown = createShutdownHandler({
      server: fakeServer(),
      logger,
      graceMs: 1_000,
      exit,
    });

    await shutdown('uncaughtException', 1);

    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logger.flush).toHaveBeenCalled();
  });

  it('ignores a second signal while already shutting down', async () => {
    const server = fakeServer();
    const logger = fakeLogger();
    const shutdown = createShutdownHandler({ server, logger, graceMs: 1_000 });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(server.close).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { reason: 'SIGINT' },
      'shutdown already in progress, ignoring',
    );
  });

  it('force-exits when teardown exceeds the grace period', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const server = fakeServer();
    const logger = fakeLogger();

    onShutdown('hangs', () => new Promise<void>(() => {}));

    const shutdown = createShutdownHandler({ server, logger, graceMs: 5_000, exit });
    void shutdown('SIGTERM');

    await vi.advanceTimersByTimeAsync(5_001);

    expect(exit).toHaveBeenCalledWith(1);
    // Only on the force path do we drop in-flight connections.
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(logger.flush).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
