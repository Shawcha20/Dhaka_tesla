import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The Prisma CLI looks for .env beside package.json, but this project keeps a
 * single .env at the repo root so that docker-compose and both apps share one
 * source of truth. Load it here rather than duplicating secrets into
 * backend/.env, where the two copies would inevitably drift.
 *
 * dotenv never overwrites an existing variable, so a real process environment
 * (Docker, Render, CI) still wins, and a backend-local .env still overrides the
 * shared one.
 */
dotenv.config({ path: path.resolve(here, '.env') });
dotenv.config({ path: path.resolve(here, '..', '.env') });

export default {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
};
