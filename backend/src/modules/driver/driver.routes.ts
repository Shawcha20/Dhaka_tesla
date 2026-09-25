import { Router } from 'express';

import { requireActiveUser, requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import {
  addMemberToPool,
  createPool,
  getCurrentPoolForDriver,
  getPoolForDriver,
} from '../pools/pool.service.js';
import {
  acceptRequestSchema,
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
