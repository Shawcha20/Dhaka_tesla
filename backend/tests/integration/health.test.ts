import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { clearReadinessChecks, registerReadinessCheck } from '../../src/lib/readiness.js';

describe('health endpoints', () => {
  let app: Express;

  beforeEach(() => {
    clearReadinessChecks();
    app = createApp();
  });

  afterEach(() => {
    clearReadinessChecks();
  });

  it('reports liveness without touching any dependency', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('echoes a request id on every response', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a caller-supplied request id so traces can span services', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'trace-abc-123');

    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'x'.repeat(65)],
    ['contains spaces', 'id with spaces'],
    ['contains delimiters', 'id;drop=1&x=2'],
  ])(
    'replaces a caller-supplied request id that is %s',
    async (_label, candidate) => {
      const res = await request(app).get('/health').set('x-request-id', candidate);

      // Unvalidated header values end up in log output verbatim, which is how
      // log injection works — so anything off-pattern is discarded.
      expect(res.headers['x-request-id']).not.toBe(candidate);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('is ready when every registered check passes', async () => {
    registerReadinessCheck({ name: 'stub', probe: async () => undefined });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ready');
    expect(res.body.data.checks).toEqual([
      expect.objectContaining({ name: 'stub', ok: true }),
    ]);
  });

  it('returns 503 and names the failing dependency when a check fails', async () => {
    registerReadinessCheck({ name: 'stub-ok', probe: async () => undefined });
    registerReadinessCheck({
      name: 'database',
      probe: async () => {
        throw new Error('connection refused');
      },
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('not_ready');
    expect(res.body.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'database', ok: false, error: 'connection refused' }),
      ]),
    );
  });
});

describe('error envelope', () => {
  it('returns a structured 404 for an unknown route', async () => {
    const res = await request(createApp()).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('reports malformed JSON as MALFORMED_JSON rather than a 500', async () => {
    const res = await request(createApp())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });
});
