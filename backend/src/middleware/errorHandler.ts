import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError, isAppError, type ErrorCode, type ErrorDetail } from '../lib/errors.js';

interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Duck-typed so this module does not depend on a generated Prisma client. */
function prismaErrorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const candidate = e as { name?: unknown; code?: unknown };
  if (
    typeof candidate.name === 'string' &&
    candidate.name.startsWith('PrismaClient') &&
    typeof candidate.code === 'string'
  ) {
    return candidate.code;
  }
  return undefined;
}

function translate(e: unknown): AppError {
  if (isAppError(e)) return e;

  if (e instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', { details: zodDetails(e), cause: e });
  }

  // body-parser rejects unparseable JSON with a SyntaxError carrying `type`.
  if (
    e instanceof SyntaxError &&
    'type' in e &&
    (e as { type?: unknown }).type === 'entity.parse.failed'
  ) {
    return new AppError('MALFORMED_JSON', { cause: e });
  }

  if (e instanceof Error) {
    if (e.name === 'TokenExpiredError') return new AppError('TOKEN_EXPIRED', { cause: e });
    if (e.name === 'JsonWebTokenError' || e.name === 'NotBeforeError') {
      return new AppError('UNAUTHENTICATED', { cause: e });
    }
  }

  const prismaCode = prismaErrorCode(e);
  if (prismaCode) {
    switch (prismaCode) {
      case 'P2002': // unique constraint
        return new AppError('INVALID_STATE_TRANSITION', {
          message: 'That record already exists.',
          cause: e,
        });
      case 'P2025': // record required but not found
        return new AppError('NOT_FOUND', { cause: e });
      case 'P2003': // foreign key constraint
        return new AppError('VALIDATION_FAILED', {
          message: 'A referenced record does not exist.',
          cause: e,
        });
      case 'P1001':
      case 'P1002': // cannot reach / timed out reaching the database
        return new AppError('DATABASE_UNAVAILABLE', { cause: e });
      default:
        break;
    }
  }

  // Anything reaching here is a bug, not an expected outcome.
  return new AppError('INTERNAL_ERROR', { cause: e });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = translate(err);

  const logPayload = {
    code: appError.code,
    status: appError.status,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
    ...appError.context,
  };

  if (appError.status >= 500) {
    // Log the original error, which carries the stack and the real cause.
    (req.log ?? console).error({ ...logPayload, err }, `unhandled: ${appError.code}`);
  } else {
    (req.log ?? console).warn(logPayload, `rejected: ${appError.code}`);
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      // A 500's real message may name internals, so it is never sent out.
      message:
        appError.status >= 500
          ? 'Something went wrong on our side.'
          : appError.message,
      requestId: req.id ?? 'unknown',
    },
  };
  if (appError.details) body.error.details = appError.details;

  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(appError.status).json(body);
};

/** Terminal handler for unmatched routes, so a 404 uses the same envelope. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError('NOT_FOUND', {
      message: `Cannot ${req.method} ${req.originalUrl}`,
    }),
  );
};
