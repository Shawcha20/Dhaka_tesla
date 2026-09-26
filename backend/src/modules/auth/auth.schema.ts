import { z } from 'zod';

/**
 * Email is lowercased and trimmed at the boundary so `Nusrat@x.com` and
 * `nusrat@x.com` cannot become two accounts. The unique index enforces one row;
 * this makes sure both spellings reach it as the same value.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email('must be a valid email address');

/**
 * A length floor and nothing else.
 *
 * Composition rules (one upper, one digit, one symbol) measurably push people
 * toward `Password1!` and are no longer recommended by NIST or OWASP. Length is
 * what actually helps, and argon2id absorbs the rest. The 72-byte ceiling is not
 * an argon2 limit — it is there so a megabyte-long password cannot be used to
 * burn CPU deliberately.
 */
const password = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(72, 'must be at most 72 characters');

/** Bangladeshi mobile numbers, the form the seed data uses. */
const phone = z
  .string()
  .trim()
  .regex(/^\+8801[3-9]\d{8}$/, 'must be a Bangladeshi mobile number, e.g. +8801711000001');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'must be at least 2 characters').max(100),
  email,
  phone: phone.optional(),
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'is required').max(72),
});

/**
 * Every field optional, so a client can send only what changed. `phone` is
 * explicitly nullable rather than merely optional — omitting it means "leave it
 * alone", sending null means "remove it", and those are different intents.
 */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'must be at least 2 characters').max(100).optional(),
    phone: phone.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'is required').max(72),
    newPassword: password,
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    path: ['newPassword'],
    message: 'must be different from your current password',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
