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

/** What a verified access token resolves to. Attached to `req.user`. */
export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}
