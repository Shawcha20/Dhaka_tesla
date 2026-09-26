import { prisma } from '../../src/lib/prisma.js';

/**
 * Child-first order. TRUNCATE ignores it because foreign key checks are disabled
 * around the loop, but keeping the order correct means the list still reads as
 * the dependency graph and would work if it ever became DELETE.
 */
const TABLES = [
  'wallet_transactions',
  'payments',
  'ride_status_history',
  'pool_members',
  'pools',
  'ride_requests',
  'wallets',
  'refresh_tokens',
  'vehicles',
  'users',
  'areas',
] as const;

/**
 * Whether a database is actually reachable.
 *
 * Integration tests skip themselves when it is not, so `npm test` still passes on
 * a machine with no Docker — the unit suite covers the fare engine, matching rule
 * and token handling without one. The alternative, a suite that fails for
 * environmental reasons, trains people to ignore red.
 */
let probeResult: Promise<boolean> | undefined;

export function databaseReachable(): Promise<boolean> {
  // Memoised so every test file shares one verdict. Probing per file meant a
  // single transient first-connection failure silently skipped that file's whole
  // suite while the others ran — tests that quietly do not run are worse than
  // tests that fail, because nothing draws attention to them.
  probeResult ??= probeDatabase();
  return probeResult;
}

async function probeDatabase(): Promise<boolean> {
  // Prisma connects lazily, so the first query also pays for pool setup. A couple
  // of retries distinguishes "no database" from "not yet".
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      if (attempt === 3) {
        console.warn(
          `[tests] database unreachable after ${attempt} attempts — integration suites will skip:`,
          error instanceof Error ? error.message.split('\n').filter(Boolean)[0] : error,
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

/**
 * Empties every table. TRUNCATE rather than DELETE so AUTO_INCREMENT restarts,
 * which keeps ids stable and readable across test runs.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of TABLES) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    // Restored even if a truncate fails, or the connection would be left with
    // integrity checking off for every later test on it.
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/** The subset of seeded areas the tests need, with the real coordinates. */
export const TEST_AREAS = [
  { name: 'Banani', latitude: '23.793900', longitude: '90.404300' },
  { name: 'Gulshan 1', latitude: '23.780600', longitude: '90.414200' },
  { name: 'Mohakhali', latitude: '23.777800', longitude: '90.406000' },
  { name: 'Uttara', latitude: '23.875900', longitude: '90.379500' },
  { name: 'Dhanmondi', latitude: '23.746100', longitude: '90.374200' },
] as const;

export interface SeededAreas {
  banani: number;
  gulshan1: number;
  mohakhali: number;
  uttara: number;
  dhanmondi: number;
}

export async function seedAreas(): Promise<SeededAreas> {
  await prisma.area.createMany({ data: TEST_AREAS.map((a) => ({ ...a })) });
  const rows = await prisma.area.findMany({ select: { id: true, name: true } });
  const byName = new Map(rows.map((r) => [r.name, r.id]));

  return {
    banani: byName.get('Banani')!,
    gulshan1: byName.get('Gulshan 1')!,
    mohakhali: byName.get('Mohakhali')!,
    uttara: byName.get('Uttara')!,
    dhanmondi: byName.get('Dhanmondi')!,
  };
}
