import type { Logger } from 'pino';

import type { AuthUser } from '../domain/auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed as the `x-request-id` response header. */
      id: string;
      /** Child logger already bound to this request's id. */
      log: Logger;
      /** Present only after `requireAuth` has run. */
      user?: AuthUser;
    }
  }
}

export {};
