import pino from 'pino';

import { env } from '../config/env.js';

/**
 * Structured JSON logs in production, human-readable in development.
 *
 * The redaction list is the important part: a log line is a place secrets leak
 * to, and this service handles passwords, JWTs and session cookies. Anything
 * matched here is replaced before it is ever written.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'dhaka-tesla-pool-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.tokenHash',
      '*.accessToken',
      '*.refreshToken',
      'body.password',
      'req.body.password',
    ],
    censor: '[redacted]',
  },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
            messageFormat: '{msg}',
          },
        },
      }),
});

export type Logger = typeof logger;
