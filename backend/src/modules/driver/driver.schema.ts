import { z } from 'zod';

export const setStatusSchema = z.object({
  isOnline: z.boolean(),
});

export const acceptRequestSchema = z.object({
  rideRequestId: z.coerce.number().int().positive(),
});

export const poolIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listRequestsSchema = z.object({
  /**
   * Off by default: the driver should see *why* a nearby request cannot be pooled
   * rather than have it silently vanish from the list. Turning this on narrows the
   * feed to requests they could actually take right now.
   */
  poolableOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const cancelPoolSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});

export const listPoolsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().positive().optional(),
});

export type ListRequestsInput = z.infer<typeof listRequestsSchema>;
export type ListPoolsInput = z.infer<typeof listPoolsSchema>;
