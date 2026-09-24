import { Router } from 'express';

import { listAreas } from './areas.service.js';

export const areasRouter = Router();

/**
 * Public and unauthenticated: both the signup-time fare preview and the ride
 * request form need it, and the list is non-sensitive reference data.
 */
areasRouter.get('/', async (_req, res) => {
  res.json({ data: await listAreas() });
});
