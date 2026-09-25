import { z } from 'zod';

/** Area ids are SMALLINT UNSIGNED, and arrive as strings from query params. */
const areaId = z.coerce.number().int().positive().max(65_535);

/** Capped at 4 to match the CHECK constraint on ride_requests.seats_requested. */
const seats = z.coerce.number().int().min(1).max(4);

export const quoteSchema = z.object({
  pickupAreaId: areaId,
  dropoffAreaId: areaId,
  seats: seats.default(1),
});

export const createRideSchema = z.object({
  pickupAreaId: areaId,
  dropoffAreaId: areaId,
  seats: seats.default(1),
  paymentMethod: z.enum(['CASH', 'TESLAPAY']).default('CASH'),
});

export const cancelRideSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});

export const rideIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Cursor pagination rather than offset.
 *
 * Ride history grows and is read newest-first, which is exactly where OFFSET
 * misbehaves: a new ride arriving between two page fetches shifts every later
 * page, so the reader sees a duplicate or misses a row. A cursor anchored on an id
 * is stable regardless of what gets inserted.
 */
export const listRidesSchema = z.object({
  status: z
    .union([
      z.enum(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']),
      z.array(
        z.enum(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']),
      ),
    ])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().positive().optional(),
});

export type QuoteInput = z.infer<typeof quoteSchema>;
export type CreateRideInput = z.infer<typeof createRideSchema>;
export type ListRidesInput = z.infer<typeof listRidesSchema>;
