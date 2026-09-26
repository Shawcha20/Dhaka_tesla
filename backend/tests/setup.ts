import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

/**
 * Runs before every test file, and crucially before `src/config/env.ts` is
 * imported anywhere in the module graph — that module calls `process.exit(1)` on
 * invalid configuration, so the values it needs have to exist by now.
 *
 * This file loads .env itself rather than relying on env.ts to have done it.
 * That ordering was a real bug: without it, `TEST_DATABASE_URL` was still unset
 * when the check below ran, so the first test file fell through to the hardcoded
 * fallback — with the wrong password — and silently skipped its entire suite,
 * while later files worked because by then env.ts had populated the shared
 * process environment. A whole suite quietly not running is worse than one
 * failing, because nothing draws attention to it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');

for (const candidate of [
  path.join(backendRoot, '.env'),
  path.join(repoRoot, '.env'),
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

process.env['NODE_ENV'] = 'test';

// The suite truncates every table, so it must never point at the development
// database. Overwrites unconditionally — dotenv will already have set
// DATABASE_URL from .env, and that value is the dev database.
if (process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
} else if (!process.env['DATABASE_URL']) {
  // Last-resort default, so a fresh clone can at least start the unit suite.
  process.env['DATABASE_URL'] =
    'mysql://tesla:tesla@127.0.0.1:3306/dhaka_tesla_pool_test';
}

// A guard rather than a comment: pointing the suite at the dev database would
// destroy the seeded demo data on the first truncate.
if (
  process.env['TEST_DATABASE_URL'] &&
  process.env['DATABASE_URL'] !== process.env['TEST_DATABASE_URL']
) {
  throw new Error('test suite is not pointed at TEST_DATABASE_URL');
}

// Deterministic, obviously fake, and long enough to satisfy the 32-char floor.
process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-'.padEnd(64, '0');
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-'.padEnd(64, '1');

process.env['LOG_LEVEL'] = 'silent';

// Pin the fare and matching constants so the hand-checked expectations in the
// fare tests cannot be invalidated by someone's local .env.
process.env['FARE_BASE_PAISA'] = '2000';
process.env['FARE_PER_KM_PAISA'] = '1500';
process.env['FARE_POOL_DISCOUNT_PCT'] = '20';
process.env['POOL_MAX_BEARING_DIFF_DEG'] = '45';
