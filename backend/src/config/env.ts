import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(backendRoot, '..');

/**
 * Load order, last writer does NOT win — dotenv never overwrites an existing
 * variable. So real process environment (Docker, Render) always beats a file,
 * and a backend-local .env beats the shared one at the repo root.
 */
for (const candidate of [
  path.join(backendRoot, '.env'),
  path.join(repoRoot, '.env'),
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

const PLACEHOLDER = /replace_me|change_me|your_secret|changeme/i;

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((v) => v.startsWith('mysql://'), 'must be a mysql:// URL'),
    TEST_DATABASE_URL: z
      .string()
      .refine((v) => v.startsWith('mysql://'), 'must be a mysql:// URL')
      .optional(),

    /* 32 chars minimum. `openssl rand -hex 32` produces 64, which is what
       .env.example tells you to use.

       ACCESS signs the JWT. REFRESH keys the HMAC that refresh tokens are stored
       under, so a stolen database is not by itself enough to validate a captured
       token. Two separate secrets means two independent blast radii. */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
    REFRESH_TOKEN_TTL: z.string().min(1).default('7d'),

    /**
     * Cookie policy.
     *
     * Deployed, the frontend (Vercel) and the API (Render) are different sites,
     * so the browser will only attach cookies to cross-site requests when
     * SameSite=None — which in turn requires Secure. Locally both are localhost,
     * where Lax works and None would be rejected over plain http.
     *
     * Routing the frontend's /api through a Next.js rewrite would make the pair
     * same-origin and allow Lax in production too; that is the stronger CSRF
     * position and is noted in the README as the next improvement.
     */
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
    COOKIE_DOMAIN: z.string().min(1).optional(),

    /** Comma-separated. Credentials are sent, so wildcards are never allowed. */
    CORS_ORIGIN: z.string().default('http://localhost:3000'),

    /* Fare constants live in the environment so the model can be re-tested by
       hand without touching code. All money is integer paisa. */
    FARE_BASE_PAISA: z.coerce.number().int().nonnegative().default(2000),
    FARE_PER_KM_PAISA: z.coerce.number().int().positive().default(1500),
    FARE_POOL_DISCOUNT_PCT: z.coerce.number().int().min(0).max(100).default(20),

    POOL_MAX_BEARING_DIFF_DEG: z.coerce.number().min(0).max(180).default(45),

    /** Trust N reverse proxies for client IP (rate limiting). Render sits behind one. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'must differ from JWT_ACCESS_SECRET — reusing one value collapses the blast radius of a leak of either',
      });
    }

    // SameSite=None without Secure is rejected outright by every current browser,
    // which would silently break sign-in rather than fail loudly here.
    if (env.COOKIE_SAMESITE === 'none' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SAMESITE'],
        message:
          'SameSite=None requires Secure cookies, which requires HTTPS — unusable outside production',
      });
    }

    // Placeholders are fine while developing; shipping them is not.
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
        if (PLACEHOLDER.test(env[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'still holds a placeholder value — generate a real secret',
          });
        }
      }
      if (env.CORS_ORIGIN.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message:
            'wildcard origins are not allowed — credentials are sent with every request',
        });
      }
    }
  });

function load() {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // Fail fast and loudly. A half-configured API that starts is worse than one
    // that refuses to: it fails later, in a request, in front of a user.
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    console.error(
      ['Invalid environment configuration:', ...lines, '', 'See .env.example.'].join(
        '\n',
      ),
    );
    process.exit(1);
  }

  const env = parsed.data;

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    isDevelopment: env.NODE_ENV === 'development',

    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),

    cookies: {
      // Secure is non-negotiable in production and impossible on plain http.
      secure: env.NODE_ENV === 'production',
      // Cross-site by default in production, Lax everywhere else.
      sameSite:
        env.COOKIE_SAMESITE ?? (env.NODE_ENV === 'production' ? 'none' : 'lax'),
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    },

    /** Passed explicitly into the fare engine, which stays a pure function. */
    fare: {
      baseFarePaisa: env.FARE_BASE_PAISA,
      perKmPaisa: env.FARE_PER_KM_PAISA,
      poolDiscountPct: env.FARE_POOL_DISCOUNT_PCT,
    },
    pooling: {
      maxBearingDiffDeg: env.POOL_MAX_BEARING_DIFF_DEG,
    },
  } as const;
}

export const env = load();
export type Env = typeof env;
