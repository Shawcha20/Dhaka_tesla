/**
 * Runs before every test file, and crucially before `src/config/env.ts` is
 * imported anywhere in the module graph — that module calls `process.exit(1)` on
 * invalid configuration, so the values it needs have to exist by now.
 *
 * Real values from a developer's .env still win; these are only fallbacks so a
 * fresh clone can run the unit suite with no setup at all.
 */
process.env['NODE_ENV'] = 'test';

// Integration tests must never touch the development database.
if (process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
}

process.env['DATABASE_URL'] ??=
  'mysql://tesla:tesla@127.0.0.1:3306/dhaka_tesla_pool_test';

// Deterministic, obviously fake, and long enough to satisfy the 32-char floor.
process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-'.padEnd(64, '0');
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-'.padEnd(64, '1');

process.env['LOG_LEVEL'] ??= 'silent';

// Pin the fare and matching constants so the hand-checked expectations in the
// fare tests cannot be invalidated by someone's local .env.
process.env['FARE_BASE_PAISA'] = '2000';
process.env['FARE_PER_KM_PAISA'] = '1500';
process.env['FARE_POOL_DISCOUNT_PCT'] = '20';
process.env['POOL_MAX_BEARING_DIFF_DEG'] = '45';
