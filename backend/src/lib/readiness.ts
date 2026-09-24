export interface ReadinessCheck {
  name: string;
  /** Resolve if healthy, throw if not. */
  probe: () => Promise<void>;
}

export interface ReadinessResult {
  ok: boolean;
  checks: { name: string; ok: boolean; error?: string; durationMs: number }[];
}

const checks: ReadinessCheck[] = [];

/**
 * Registered rather than hard-coded so `/ready` does not need to know what its
 * dependencies are. The database check is added when the Prisma client is
 * wired up; a cache or upstream would register itself the same way.
 */
export function registerReadinessCheck(check: ReadinessCheck): void {
  checks.push(check);
}

/** Exposed for tests, which need a clean registry per suite. */
export function clearReadinessChecks(): void {
  checks.length = 0;
}

export async function runReadinessChecks(): Promise<ReadinessResult> {
  const results = await Promise.all(
    checks.map(async ({ name, probe }) => {
      const startedAt = process.hrtime.bigint();
      try {
        await probe();
        return {
          name,
          ok: true,
          durationMs: elapsedMs(startedAt),
        };
      } catch (e) {
        return {
          name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          durationMs: elapsedMs(startedAt),
        };
      }
    }),
  );

  return { ok: results.every((r) => r.ok), checks: results };
}

/** Nanoseconds since `startedAt`, as milliseconds rounded to 2 decimals. */
function elapsedMs(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;
}
