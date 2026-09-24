/**
 * One registry for every error this API can return.
 *
 * The HTTP status is derived from the code rather than passed at each throw
 * site, so `POOL_CAPACITY_EXCEEDED` is a 409 everywhere, forever, and the
 * client's `code` contract cannot drift from the status it arrives with.
 */
export const ERROR_CATALOG = {
  /* 400 */
  VALIDATION_FAILED: { status: 400, message: 'The request body failed validation.' },
  MALFORMED_JSON: { status: 400, message: 'Request body is not valid JSON.' },

  /* 401 — deliberately vague. Never reveal which half of a credential was wrong. */
  INVALID_CREDENTIALS: { status: 401, message: 'Email or password is incorrect.' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication is required.' },
  TOKEN_EXPIRED: { status: 401, message: 'Session has expired. Please sign in again.' },
  TOKEN_REUSE_DETECTED: {
    status: 401,
    message: 'This session has been revoked. Please sign in again.',
  },

  /* 403 */
  FORBIDDEN_ROLE: { status: 403, message: 'Your account role cannot perform this action.' },
  VEHICLE_OFFLINE: { status: 403, message: 'Go online before accepting rides.' },
  ACCOUNT_DISABLED: { status: 403, message: 'This account is disabled.' },

  /* 404 — used instead of 403 for another user's resource, so the API never
     confirms that someone else's id exists. */
  NOT_FOUND: { status: 404, message: 'Not found.' },
  RIDE_NOT_FOUND: { status: 404, message: 'Ride not found.' },
  POOL_NOT_FOUND: { status: 404, message: 'Pool not found.' },
  AREA_NOT_FOUND: { status: 404, message: 'Area not found.' },
  VEHICLE_NOT_FOUND: { status: 404, message: 'You do not have a Tesla registered.' },

  /* 409 — the request was well formed but conflicts with current state. */
  EMAIL_ALREADY_REGISTERED: { status: 409, message: 'That email is already registered.' },
  PASSENGER_HAS_ACTIVE_RIDE: {
    status: 409,
    message: 'You already have a ride in progress.',
  },
  DRIVER_HAS_ACTIVE_POOL: {
    status: 409,
    message: 'Finish or cancel your current trip first.',
  },
  RIDE_ALREADY_MATCHED: {
    status: 409,
    message: 'Another driver has already accepted this ride.',
  },
  POOL_CAPACITY_EXCEEDED: { status: 409, message: 'Not enough seats left.' },
  POOL_NOT_FORMING: { status: 409, message: 'This pool is no longer accepting passengers.' },
  POOL_EMPTY: { status: 409, message: 'Cannot start a trip with no passengers.' },
  RIDE_NOT_CANCELLABLE: { status: 409, message: 'This ride can no longer be cancelled.' },
  INVALID_STATE_TRANSITION: { status: 409, message: 'That is not a valid next step.' },
  INSUFFICIENT_WALLET_BALANCE: {
    status: 409,
    message: 'Your TeslaPay balance is too low for this fare.',
  },
  POOL_IN_PROGRESS: { status: 409, message: 'You cannot go offline during a trip.' },

  /* 422 — semantically invalid rather than malformed. */
  SAME_PICKUP_AND_DROPOFF: {
    status: 422,
    message: 'Pickup and destination must be different areas.',
  },
  ROUTE_NOT_COMPATIBLE: {
    status: 422,
    message: 'These routes are not heading the same way.',
  },

  /* 429 / 500 */
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please slow down.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong on our side.' },
  DATABASE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * An error we meant to produce. The error handler trusts its message and sends
 * it to the client; anything that is *not* an AppError is treated as a bug and
 * reported as a generic 500 with the detail kept in the logs.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];
  /** Extra context for the log line only. Never serialised to the client. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      details?: ErrorDetail[];
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    const entry = ERROR_CATALOG[code];
    super(options.message ?? entry.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = entry.status;
    if (options.details) this.details = options.details;
    if (options.context) this.context = options.context;
    Error.captureStackTrace?.(this, AppError);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Shorthand so services read as `throw fail('POOL_CAPACITY_EXCEEDED', { ... })`. */
export function fail(
  code: ErrorCode,
  options?: ConstructorParameters<typeof AppError>[1],
): AppError {
  return new AppError(code, options);
}
