import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { databaseReachable, resetDatabase } from '../helpers/db.js';

const hasDatabase = await databaseReachable();

const NUSRAT = {
  name: 'Nusrat Jahan',
  email: 'nusrat@dhakatesla.test',
  phone: '+8801711000002',
  password: 'TeslaPool#2026',
};

/** Reads one cookie's value out of a Set-Cookie header array. */
function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = all.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=')[1];
}

function cookieAttributes(res: request.Response, name: string): string {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return all.find((c) => c.startsWith(`${name}=`)) ?? '';
}

describe.skipIf(!hasDatabase)('authentication', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('POST /auth/register', () => {
    it('creates a passenger and signs them in', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(NUSRAT);

      expect(res.status).toBe(201);
      expect(res.body.data.user).toMatchObject({
        name: 'Nusrat Jahan',
        email: 'nusrat@dhakatesla.test',
        role: 'PASSENGER',
      });
      expect(cookieValue(res, 'dtp_access')).toBeTruthy();
      expect(cookieValue(res, 'dtp_refresh')).toBeTruthy();
    });

    it('never returns the password hash', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(NUSRAT);

      // Checked against the whole serialised body, not just the fields we expect,
      // so a future field cannot leak it unnoticed.
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|password_hash/i);
    });

    it('marks the cookies httpOnly so scripts cannot read them', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(NUSRAT);

      expect(cookieAttributes(res, 'dtp_access').toLowerCase()).toContain('httponly');
      expect(cookieAttributes(res, 'dtp_refresh').toLowerCase()).toContain('httponly');
    });

    it('scopes the refresh cookie to the auth path only', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(NUSRAT);

      // The longer-lived credential should not ride along on every API call.
      expect(cookieAttributes(res, 'dtp_refresh')).toContain('Path=/api/v1/auth');
      expect(cookieAttributes(res, 'dtp_access')).toContain('Path=/');
    });

    it('creates an empty wallet alongside the account', async () => {
      await request(app).post('/api/v1/auth/register').send(NUSRAT);

      const wallet = await prisma.wallet.findFirst({
        where: { user: { email: NUSRAT.email } },
      });
      expect(wallet?.balancePaisa).toBe(0n);
    });

    it('rejects a duplicate email with 409', async () => {
      await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const res = await request(app).post('/api/v1/auth/register').send(NUSRAT);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('treats differently-cased emails as the same account', async () => {
      await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...NUSRAT, email: 'NUSRAT@DhakaTesla.TEST' });

      expect(res.status).toBe(409);
    });

    it('stores the email lowercased', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ ...NUSRAT, email: '  NUSRAT@DhakaTesla.TEST  ' });

      const user = await prisma.user.findUnique({ where: { email: NUSRAT.email } });
      expect(user).not.toBeNull();
    });

    it.each([
      ['a missing name', { ...NUSRAT, name: undefined }],
      ['a one-character name', { ...NUSRAT, name: 'N' }],
      ['a malformed email', { ...NUSRAT, email: 'not-an-email' }],
      ['a short password', { ...NUSRAT, password: 'short' }],
      ['a non-Bangladeshi phone', { ...NUSRAT, phone: '+1555000111' }],
    ])('rejects %s with 400 and field details', async (_label, body) => {
      const res = await request(app).post('/api/v1/auth/register').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('accepts a signup without a phone number', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: NUSRAT.name, email: NUSRAT.email, password: NUSRAT.password });

      expect(res.status).toBe(201);
      expect(res.body.data.user.phone).toBeNull();
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(NUSRAT);
    });

    it('signs in with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(NUSRAT.email);
      expect(cookieValue(res, 'dtp_access')).toBeTruthy();
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: 'definitely-wrong' });

      const unknownEmail = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@dhakatesla.test', password: NUSRAT.password });

      // Differing responses would turn this endpoint into an account-existence
      // oracle, which is why both paths also do the same amount of hashing work.
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });

    it('refuses a disabled account', async () => {
      await prisma.user.update({
        where: { email: NUSRAT.email },
        data: { isActive: false },
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    });

    it('issues a distinct refresh token per sign-in', async () => {
      const first = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });
      const second = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });

      // Two devices, two independent sessions — revoking one must not touch the other.
      expect(cookieValue(first, 'dtp_refresh')).not.toBe(cookieValue(second, 'dtp_refresh'));
      expect(await prisma.refreshToken.count()).toBe(3); // register + two logins
    });

    it('stores refresh tokens hashed, never in plaintext', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });

      const raw = cookieValue(res, 'dtp_refresh')!;
      const stored = await prisma.refreshToken.findMany({ select: { tokenHash: true } });

      expect(stored.every((t) => t.tokenHash !== raw)).toBe(true);
      expect(stored.every((t) => /^[0-9a-f]{64}$/.test(t.tokenHash))).toBe(true);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the caller when authenticated by cookie', async () => {
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/register').send(NUSRAT);

      const res = await agent.get('/api/v1/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(NUSRAT.email);
      expect(res.body.data.walletBalancePaisa).toBe(0);
      expect(res.body.data.vehicle).toBeNull();
    });

    it('accepts a bearer token, so the API can be driven from curl', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const token = cookieValue(registered, 'dtp_access')!;

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(NUSRAT.email);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a tampered token', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const token = cookieValue(registered, 'dtp_access')!;

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token.slice(0, -3)}xyz`);

      expect(res.status).toBe(401);
    });

    it('includes the vehicle for a driver', async () => {
      const jashim = await prisma.user.create({
        data: {
          name: 'Jashim Uddin',
          email: 'jashim@dhakatesla.test',
          passwordHash: await hashPassword(NUSRAT.password),
          role: 'DRIVER',
        },
      });
      await prisma.vehicle.create({
        data: {
          driverId: jashim.id,
          name: 'Bullet',
          plateNo: 'DHA-TESLA-01',
          capacity: 3,
        },
      });

      const agent = request.agent(app);
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'jashim@dhakatesla.test', password: NUSRAT.password });

      const res = await agent.get('/api/v1/auth/me');

      expect(res.body.data.vehicle).toMatchObject({
        name: 'Bullet',
        capacity: 3,
        isOnline: false,
      });
      // Drivers collect fares rather than holding a rider wallet.
      expect(res.body.data.walletBalancePaisa).toBeNull();
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and keeps the session usable', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const original = cookieValue(registered, 'dtp_refresh')!;

      const rotated = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: original });

      expect(rotated.status).toBe(200);
      const replacement = cookieValue(rotated, 'dtp_refresh')!;
      expect(replacement).not.toBe(original);

      // The new token works...
      const again = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: replacement });
      expect(again.status).toBe(200);
    });

    it('revokes every session when a used token is replayed', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const original = cookieValue(registered, 'dtp_refresh')!;

      await request(app).post('/api/v1/auth/refresh').send({ refreshToken: original });

      // Replaying a rotated token means either the client or an attacker is
      // reusing it, and we cannot tell which — so every session is cut.
      const replay = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: original });

      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
      expect(live).toBe(0);
    });

    it('rejects an unknown token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'nonsense-token-value' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a request with no token at all', async () => {
      const res = await request(app).post('/api/v1/auth/refresh').send({});

      expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const original = cookieValue(registered, 'dtp_refresh')!;

      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: original });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and clears both cookies', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const refreshToken = cookieValue(registered, 'dtp_refresh')!;

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', `dtp_refresh=${refreshToken}`);

      expect(res.status).toBe(204);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);

      // The refresh token must no longer buy a new session.
      const afterwards = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(afterwards.status).toBe(401);
    });

    it('succeeds even with no token, and is safe to repeat', async () => {
      // Logout that can fail leaves the user believing they are still signed in.
      expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
      expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
    });

    it('leaves other sessions alone', async () => {
      await request(app).post('/api/v1/auth/register').send(NUSRAT);
      const phone = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });
      const laptop = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: NUSRAT.email, password: NUSRAT.password });

      await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', `dtp_refresh=${cookieValue(phone, 'dtp_refresh')}`);

      // Signing out on one device must not sign you out everywhere.
      const stillValid = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: cookieValue(laptop, 'dtp_refresh') });
      expect(stillValid.status).toBe(200);
    });
  });
});

describe.skipIf(hasDatabase)('authentication (skipped)', () => {
  it('needs a reachable MySQL — run `docker compose up` first', () => {
    expect(hasDatabase).toBe(false);
  });
});
