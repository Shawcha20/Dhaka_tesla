import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  createJashim,
  createNusrat,
  createRafiq,
  type Actor,
  type DriverActor,
} from '../helpers/actors.js';
import { databaseReachable, resetDatabase, seedAreas, type SeededAreas } from '../helpers/db.js';

const hasDatabase = await databaseReachable();

describe.skipIf(!hasDatabase)('ride lifecycle', () => {
  let app: Express;
  let areas: SeededAreas;
  let nusrat: Actor;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    areas = await seedAreas();
    nusrat = await createNusrat(app);
  });

  describe('POST /rides/quote', () => {
    it('prices the README example to the paisa', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides/quote')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali, seats: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.distanceKm).toBe('1.799');
      expect(res.body.data.soloFarePaisa).toBe(4699);
      expect(res.body.data.estimatedPooledFarePaisa).toBe(4159);
      expect(res.body.data.breakdown).toMatchObject({
        baseFarePaisa: 2000,
        distanceChargePaisa: 2699,
        seats: 1,
      });
    });

    it('prices Rafiq to Gulshan 1 at 46.84 solo', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides/quote')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      expect(res.body.data.soloFarePaisa).toBe(4684);
      expect(res.body.data.estimatedPooledFarePaisa).toBe(4147);
    });

    it('scales with seats', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides/quote')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali, seats: 2 });

      expect(res.body.data.soloFarePaisa).toBe(4699 * 2);
    });

    it('refuses a trip to the pickup area', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides/quote')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.banani });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SAME_PICKUP_AND_DROPOFF');
    });

    it('refuses an area that does not exist', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides/quote')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: 9999 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AREA_NOT_FOUND');
    });

    it('creates nothing', async () => {
      await nusrat.agent
        .post('/api/v1/rides/quote')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      expect(await prisma.rideRequest.count()).toBe(0);
    });

    it.each([
      ['seats above the vehicle maximum', { seats: 5 }],
      ['zero seats', { seats: 0 }],
      ['a missing pickup', { pickupAreaId: undefined }],
    ])('rejects %s', async (_label, override) => {
      const res = await nusrat.agent.post('/api/v1/rides/quote').send({
        pickupAreaId: areas.banani,
        dropoffAreaId: areas.mohakhali,
        ...override,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /rides', () => {
    it('creates a REQUESTED ride with the solo fare', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali, seats: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'REQUESTED',
        seats: 1,
        distanceKm: '1.799',
        estimatedFarePaisa: 4699,
        finalFarePaisa: null,
        pool: null,
      });
    });

    it('starts the timeline at creation', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      // Creation is itself a transition, from nothing to REQUESTED.
      expect(res.body.data.timeline).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: 'REQUESTED',
          by: 'Nusrat Jahan',
          actorRole: 'PASSENGER',
        }),
      ]);
    });

    it('stores the distance as a snapshot, not a derived value', async () => {
      const res = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      // Moving the area afterwards must not rewrite the recorded distance, or the
      // fare charged becomes unexplainable.
      await prisma.area.update({
        where: { id: areas.mohakhali },
        data: { latitude: '23.500000' },
      });

      const after = await nusrat.agent.get(`/api/v1/rides/${res.body.data.id}`);
      expect(after.body.data.distanceKm).toBe('1.799');
      expect(after.body.data.estimatedFarePaisa).toBe(4699);
    });

    it('refuses a second active ride for the same passenger', async () => {
      await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      const second = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('PASSENGER_HAS_ACTIVE_RIDE');
    });

    it('allows a new ride once the previous one is cancelled', async () => {
      const first = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      await nusrat.agent.patch(`/api/v1/rides/${first.body.data.id}/cancel`).send({});

      const second = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      expect(second.status).toBe(201);
    });

    it('holds the one-active-ride rule under two simultaneous requests', async () => {
      // Check-then-insert would let both through; the user row is locked for the
      // duration of the check so they serialise instead.
      const body = { pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali };
      const [a, b] = await Promise.all([
        nusrat.agent.post('/api/v1/rides').send(body),
        nusrat.agent.post('/api/v1/rides').send(body),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect(await prisma.rideRequest.count()).toBe(1);
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      expect(res.status).toBe(401);
    });

    it('refuses a driver', async () => {
      const jashim: DriverActor = await createJashim(app);

      const res = await jashim.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    });

    it('refuses a disabled account', async () => {
      await prisma.user.update({ where: { id: nusrat.id }, data: { isActive: false } });

      const res = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('GET /rides/:id — ownership', () => {
    it('refuses another passenger with 404, not 403', async () => {
      const rafiq = await createRafiq(app);
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      const res = await rafiq.agent.get(`/api/v1/rides/${ride.body.data.id}`);

      // 404 rather than 403 so the API never confirms that someone else's ride
      // id exists.
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RIDE_NOT_FOUND');
    });

    it('refuses a ride that does not exist', async () => {
      const res = await nusrat.agent.get('/api/v1/rides/999999');

      expect(res.status).toBe(404);
    });

    it('rejects a non-numeric id', async () => {
      const res = await nusrat.agent.get('/api/v1/rides/abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /rides/mine', () => {
    it('returns only the caller\'s rides, newest first', async () => {
      const rafiq = await createRafiq(app);

      const first = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      await nusrat.agent.patch(`/api/v1/rides/${first.body.data.id}/cancel`).send({});
      const second = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      await rafiq.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.uttara });

      const res = await nusrat.agent.get('/api/v1/rides/mine');

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe(second.body.data.id);
      expect(res.body.data[1].id).toBe(first.body.data.id);
    });

    it('filters by status', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      const cancelled = await nusrat.agent.get('/api/v1/rides/mine?status=CANCELLED');
      const requested = await nusrat.agent.get('/api/v1/rides/mine?status=REQUESTED');

      expect(cancelled.body.data).toHaveLength(1);
      expect(requested.body.data).toHaveLength(0);
    });

    it('paginates with a stable cursor', async () => {
      for (let i = 0; i < 3; i += 1) {
        const ride = await nusrat.agent
          .post('/api/v1/rides')
          .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
        await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});
      }

      const page1 = await nusrat.agent.get('/api/v1/rides/mine?limit=2');
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta.nextCursor).toBeTruthy();

      const page2 = await nusrat.agent.get(
        `/api/v1/rides/mine?limit=2&cursor=${page1.body.meta.nextCursor}`,
      );
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.meta.nextCursor).toBeNull();

      // No row appears on both pages.
      const ids = [...page1.body.data, ...page2.body.data].map((r: { id: number }) => r.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('PATCH /rides/:id/cancel', () => {
    it('cancels a REQUESTED ride and records the reason', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      const res = await nusrat.agent
        .patch(`/api/v1/rides/${ride.body.data.id}/cancel`)
        .send({ reason: 'Found a CNG' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.cancelReason).toBe('Found a CNG');
      expect(res.body.data.cancelledAt).toBeTruthy();
    });

    it('appends the cancellation to the timeline', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      const res = await nusrat.agent
        .patch(`/api/v1/rides/${ride.body.data.id}/cancel`)
        .send({ reason: 'Changed my mind' });

      expect(res.body.data.timeline).toHaveLength(2);
      expect(res.body.data.timeline[1]).toMatchObject({
        fromStatus: 'REQUESTED',
        toStatus: 'CANCELLED',
        note: 'Changed my mind',
      });
    });

    it('cancels without a reason', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      const res = await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.cancelReason).toBeNull();
    });

    it('refuses to cancel twice', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      const again = await nusrat.agent
        .patch(`/api/v1/rides/${ride.body.data.id}/cancel`)
        .send({});

      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('RIDE_NOT_CANCELLABLE');
    });

    it('refuses to cancel a ride that has started', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      // Forced directly, since driving the pool there needs the driver flow.
      await prisma.rideRequest.update({
        where: { id: BigInt(ride.body.data.id) },
        data: { status: 'STARTED', startedAt: new Date() },
      });

      const res = await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      // The passenger is in the vehicle and the fare is locked; there is nothing
      // left to cancel.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RIDE_NOT_CANCELLABLE');
    });

    it('refuses to cancel a completed ride', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      await prisma.rideRequest.update({
        where: { id: BigInt(ride.body.data.id) },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      const res = await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      expect(res.status).toBe(409);
    });

    it('refuses to cancel another passenger\'s ride', async () => {
      const rafiq = await createRafiq(app);
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });

      const res = await rafiq.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      expect(res.status).toBe(404);
      // And the ride is untouched.
      const stored = await prisma.rideRequest.findUnique({
        where: { id: BigInt(ride.body.data.id) },
      });
      expect(stored?.status).toBe('REQUESTED');
    });

    it('records who cancelled', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      await nusrat.agent.patch(`/api/v1/rides/${ride.body.data.id}/cancel`).send({});

      const stored = await prisma.rideRequest.findUnique({
        where: { id: BigInt(ride.body.data.id) },
      });
      expect(stored?.cancelledBy).toBe(nusrat.id);
    });
  });
});

describe.skipIf(hasDatabase)('ride lifecycle (skipped)', () => {
  it('needs a reachable MySQL — run `docker compose up` first', () => {
    expect(hasDatabase).toBe(false);
  });
});
