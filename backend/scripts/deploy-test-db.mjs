/**
 * Applies migrations to the *test* database.
 *
 * The integration suite truncates every table between tests, so it must never
 * point at the development database. `TEST_DATABASE_URL` names a separate schema
 * (created on first boot by docker/mysql/init), and this script runs
 * `prisma migrate deploy` against it.
 *
 * A script rather than an inline `DATABASE_URL=... prisma migrate deploy`, because
 * that syntax does not work in PowerShell — and this project is developed on
 * Windows. No new dependency: dotenv is already here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(backendRoot, '..');

for (const candidate of [
  path.join(backendRoot, '.env'),
  path.join(repoRoot, '.env'),
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    'TEST_DATABASE_URL is not set. Copy .env.example to .env — it documents the value.',
  );
  process.exit(1);
}

// Guard against the mistake this script exists to prevent.
if (testUrl === process.env.DATABASE_URL) {
  console.error(
    'TEST_DATABASE_URL and DATABASE_URL are identical. The suite truncates every\n' +
      'table, so this would destroy your development data. Point them at different schemas.',
  );
  process.exit(1);
}

const redacted = testUrl.replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@');
console.log(`Applying migrations to ${redacted}`);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: backendRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: testUrl },
});

process.exit(result.status ?? 1);
