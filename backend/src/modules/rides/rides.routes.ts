import { Router } from 'express';

import { requireActiveUser, requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import {
  cancelRideSchema,
  createRideSchema,
  listRidesSchema,
  quoteSchema,
  rideIdParamSchema,
} from './rides.schema.js';
import {
  cancelRide,
  createRide,
  getRideForPassenger,
  listRidesForPassenger,
  quote,
} from './rides.service.js';

export const ridesRouter = Router();

/**
 * Every route here is passenger-only. Applied once at the router rather than
 * repeated per route, so a new endpoint cannot be added without a guard.
 */
ridesRouter.use(requireAuth, requireRole('PASSENGER'));

/** Priced but not persisted, so the form can quote as it is filled in. */
ridesRouter.post('/quote', async (req, res) => {
  const input = quoteSchema.parse(req.body);
  res.json({ data: await quote(input) });
});

/**
 * `requireActiveUser` costs one query and is used only where acting on a stale
 * token would commit someone to something — here, a real ride.
 */
ridesRouter.post('/', writeLimiter, requireActiveUser, async (req, res) => {
  const input = createRideSchema.parse(req.body);
  res.status(201).json({ data: await createRide(req.user!.id, input) });
});

ridesRouter.get('/mine', async (req, res) => {
  const filters = listRidesSchema.parse(req.query);
  res.json(await listRidesForPassenger(req.user!.id, filters));
});

ridesRouter.get('/:id', async (req, res) => {
  const { id } = rideIdParamSchema.parse(req.params);
  res.json({ data: await getRideForPassenger(BigInt(id), req.user!.id) });
});

ridesRouter.patch('/:id/cancel', requireActiveUser, async (req, res) => {
  const { id } = rideIdParamSchema.parse(req.params);
  const { reason } = cancelRideSchema.parse(req.body ?? {});
  res.json({ data: await cancelRide(BigInt(id), req.user!.id, reason) });
});
