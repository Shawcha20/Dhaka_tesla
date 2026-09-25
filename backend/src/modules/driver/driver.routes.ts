import { Router } from 'express';

import { requireActiveUser, requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import {
  cancelPool,
  completeTrip,
  listPoolsForDriver,
  markArrived,
  startTrip,
} from '../pools/pool.lifecycle.js';
import {
  addMemberToPool,
  createPool,
  getCurrentPoolForDriver,
  getPoolForDriver,
} from '../pools/pool.service.js';
import {
  acceptRequestSchema,
  cancelPoolSchema,
  listPoolsSchema,
  listRequestsSchema,
  poolIdParamSchema,
  setStatusSchema,
} from './driver.schema.js';
import { listRelevantRequests, setOnlineStatus } from './driver.service.js';

export const driverRouter = Router();

/** Driver-only, applied at the router so a new route cannot be added unguarded. */
driverRouter.use(requireAuth, requireRole('DRIVER'));

driverRouter.patch('/status', requireActiveUser, async (req, res) => {
  const { isOnline } = setStatusSchema.parse(req.body);
  res.json({ data: await setOnlineStatus(req.user!.id, isOnline) });
});

driverRouter.get('/requests', async (req, res) => {
  const filters = listRequestsSchema.parse(req.query);
  res.json(await listRelevantRequests(req.user!.id, filters));
});

/** Accept a request and open a pool around it. */
driverRouter.post('/pools', writeLimiter, requireActiveUser, async (req, res) => {
  const { rideRequestId } = acceptRequestSchema.parse(req.body);
  res.status(201).json({ data: await createPool(req.user!.id, BigInt(rideRequestId)) });
});

driverRouter.get('/pools/current', async (req, res) => {
  res.json({ data: await getCurrentPoolForDriver(req.user!.id) });
});

/** Trip history with per-trip earnings and seat utilisation. */
driverRouter.get('/pools', async (req, res) => {
  const filters = listPoolsSchema.parse(req.query);
  res.json(await listPoolsForDriver(req.user!.id, filters));
});

// Declared after /pools/current so the literal segment is not swallowed by :id.
driverRouter.get('/pools/:id', async (req, res) => {
  const { id } = poolIdParamSchema.parse(req.params);
  res.json({ data: await getPoolForDriver(BigInt(id), req.user!.id) });
});

/**
 * Add a passenger to a forming pool. **The concurrency-critical endpoint** —
 * see tryClaimSeats in pool.service.ts.
 */
driverRouter.post('/pools/:id/members', writeLimiter, requireActiveUser, async (req, res) => {
  const { id } = poolIdParamSchema.parse(req.params);
  const { rideRequestId } = acceptRequestSchema.parse(req.body);

  res
    .status(201)
    .json({ data: await addMemberToPool(req.user!.id, BigInt(id), BigInt(rideRequestId)) });
});

// ─── Trip controls ──────────────────────────────────────────────────────────

/** FORMING → DRIVER_ARRIVED. The pool stops accepting passengers. */
driverRouter.patch('/pools/:id/arrive', requireActiveUser, async (req, res) => {
  const { id } = poolIdParamSchema.parse(req.params);
  res.json({ data: await markArrived(req.user!.id, BigInt(id)) });
});

/** DRIVER_ARRIVED → STARTED. Fares lock and payments are raised. */
driverRouter.patch('/pools/:id/start', requireActiveUser, async (req, res) => {
  const { id } = poolIdParamSchema.parse(req.params);
  res.json({ data: await startTrip(req.user!.id, BigInt(id)) });
});

/** STARTED → COMPLETED. Payments settle; the response itemises each one. */
driverRouter.patch('/pools/:id/complete', requireActiveUser, async (req, res) => {
  const { id } = poolIdParamSchema.parse(req.params);
  const { pool, settlement } = await completeTrip(req.user!.id, BigInt(id));
  res.json({ data: pool, meta: { settlement } });
});

/** Cancels the trip. Members return to REQUESTED, not CANCELLED. */
driverRouter.patch('/pools/:id/cancel', requireActiveUser, async (req, res) => {
  const { id } = poolIdParamSchema.parse(req.params);
  const { reason } = cancelPoolSchema.parse(req.body ?? {});
  res.json({ data: await cancelPool(req.user!.id, BigInt(id), reason) });
});
