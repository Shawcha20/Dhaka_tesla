import { Router } from 'express';

import { areasRouter } from './modules/areas/areas.routes.js';

/**
 * Everything under /api/v1.
 *
 * Versioned in the path because the frontend deploys separately from the API: a
 * breaking change has to be able to ship without the two being updated in
 * lockstep. Health probes deliberately live outside this prefix — an
 * orchestrator should not have to know the API version.
 */
export const apiRouter = Router();

apiRouter.use('/areas', areasRouter);
