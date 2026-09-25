/**
 * Domain-level role and identity types.
 *
 * Declared here rather than imported from the generated Prisma client so that
 * the state machine, fare engine and middleware stay testable without a
 * database or a `prisma generate` step. Prisma's generated enums are string
 * unions with these same members, so the two are structurally compatible.
 */
export const ROLES = ['PASSENGER', 'DRIVER'] as const;
export type Role = (typeof ROLES)[number];

export const ACTOR_ROLES = ['PASSENGER', 'DRIVER', 'SYSTEM'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/**
 * What a verified access token resolves to. Attached to `req.user`.
 *
 * `id` is a bigint to match the database: every primary key in this schema is
 * BIGINT, and converting at the auth boundary would mean converting back at every
 * query. One numeric type for ids throughout the backend, serialised to a JSON
 * number on the way out — see lib/json.ts.
 */
export interface AuthUser {
  id: bigint;
  email: string;
  role: Role;
}
