import { logger } from './logger.js';

type ShutdownHook = { name: string; run: () => Promise<void> | void };

const hooks: ShutdownHook[] = [];

/**
 * Registered rather than called directly from the server, so a module that owns
 * a resource (the Prisma pool, for instance) also owns its own teardown and the
 * server does not need to import it.
 */
export function onShutdown(name: string, run: ShutdownHook['run']): void {
  hooks.push({ name, run });
}

/** Exposed for tests, which need a clean registry per case. */
export function clearShutdownHooks(): void {
  hooks.length = 0;
}

/** Runs hooks in reverse registration order, like a stack of defers. */
export async function runShutdownHooks(): Promise<void> {
  for (const hook of [...hooks].reverse()) {
    try {
      await hook.run();
      logger.debug({ hook: hook.name }, 'shutdown hook complete');
    } catch (e) {
      // One failing hook must not prevent the rest from running.
      logger.error({ hook: hook.name, err: e }, 'shutdown hook failed');
    }
  }
}
