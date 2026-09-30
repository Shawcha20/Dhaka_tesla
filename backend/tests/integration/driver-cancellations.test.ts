import type { Express } from 'express';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  createJashim,
  createKamal,
  createNusrat,
  createPassenger,
  createRafiq,
  type Actor,
  type DriverActor,
} from '../helpers/actors.js';
import { databaseReachable, resetDatabase, seedAreas, type SeededAreas } from '../helpers/db.js';

const hasDatabase = await databaseReachable();

/**
 * What happens after a driver cancels an accepted trip.
 *
 * The passengers go back into the queue for everyone else; the driver who dropped
 * them stops being offered them; and a driver who does this too often is stopped
 * from accepting until enough of those cancellations age out.
 */
describe.skipIf(!hasDatabase)('driver cancellations', () => {
  let app: Express;
  let areas: SeededAreas;
  let jashim: DriverActor;
  let kamal: DriverActor;
  let nusrat: Actor;
  let rafiq: Actor;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    areas = await seedAreas();
    jashim = await createJashim(app);
    kamal = await createKamal(app);
    nusrat = await createNusrat(app);
    rafiq = await createRafiq(app);
  });

  async function request(passenger: Actor, dropoffAreaId = areas.mohakhali): Promise<number> {
    const res = await passenger.agent.post('/api/v1/rides').send({
      pickupAreaId: areas.banani,
      dropoffAreaId,
      paymentMethod: 'CASH',
    });
    expect(res.status).toBe(201);
    return res.body.data.id as number;
  }

  /** Accepts the ride into a fresh pool, then cancels that pool. */
  async function acceptThenCancel(driver: DriverActor, rideId: number) {
    const pool = await driver.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });
    expect(pool.status).toBe(201);
    return driver.agent
      .patch(`/api/v1/driver/pools/${pool.body.data.id}/cancel`)
      .send({ reason: 'Battery low' });
  }

  async function feedIds(driver: DriverActor): Promise<number[]> {
    const res = await driver.agent.get('/api/v1/driver/requests');
    expect(res.status).toBe(200);
    return (res.body.data as { id: number }[]).map((r) => r.id);
  }

  describe('the dropped passenger', () => {
    it('disappears from the feed of the driver who cancelled', async () => {
      const rideId = await request(nusrat);
      await acceptThenCancel(jashim, rideId);

      expect(await feedIds(jashim)).not.toContain(rideId);
    });

    it('stays visible to every other driver', async () => {
      const rideId = await request(nusrat);
      await acceptThenCancel(jashim, rideId);

      // One driver giving up on Nusrat must not cancel her ride for all of them.
      expect(await feedIds(kamal)).toContain(rideId);
    });

    it('is still a live request, not a cancelled one', async () => {
      const rideId = await request(nusrat);
      await acceptThenCancel(jashim, rideId);

      const ride = await nusrat.agent.get(`/api/v1/rides/${rideId}`);
      expect(ride.body.data.status).toBe('REQUESTED');
    });

    it('no longer shows the passenger the Tesla that dropped them', async () => {
      const rideId = await request(nusrat);
      await acceptThenCancel(jashim, rideId);

      const ride = (await nusrat.agent.get(`/api/v1/rides/${rideId}`)).body.data;

      // Not "Your Tesla — driven by Jashim" with a Call button: he is gone.
      expect(ride.pool).toBeNull();
      // And priced as what she now is again — a waiting request, at its quote.
      expect(ride.currentFarePaisa).toBe(ride.estimatedFarePaisa);
    });

    it('cannot be accepted again by the driver who dropped it', async () => {
      const rideId = await request(nusrat);
      await acceptThenCancel(jashim, rideId);

      // The feed hides it, but a stale screen could still send the request, so the
      // rule has to hold on the server too.
      const again = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: rideId });

      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('RIDE_PREVIOUSLY_CANCELLED_BY_YOU');
    });

    it('cannot be added to a later trip by the driver who dropped it', async () => {
      const nusratRide = await request(nusrat);
      await acceptThenCancel(jashim, nusratRide);

      const rafiqRide = await request(rafiq, areas.gulshan1);
      const pool = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: rafiqRide });

      const join = await jashim.agent
        .post(`/api/v1/driver/pools/${pool.body.data.id}/members`)
        .send({ rideRequestId: nusratRide });

      expect(join.status).toBe(409);
      expect(join.body.error.code).toBe('RIDE_PREVIOUSLY_CANCELLED_BY_YOU');
    });

    it('can be accepted by another driver', async () => {
      const rideId = await request(nusrat);
      await acceptThenCancel(jashim, rideId);

      const res = await kamal.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });

      expect(res.status).toBe(201);
    });
  });

  describe('the cancellation limit', () => {
    const { limit, windowHours } = env.driverCancellations;

    /** Cancels `count` trips as Jashim, each with a different passenger. */
    async function cancelTrips(count: number) {
      for (let i = 0; i < count; i += 1) {
        const passenger = await createPassenger(app, {
          name: `Passenger ${String.fromCharCode(65 + i)}`,
          email: `passenger-${i}@dhakatesla.test`,
        });
        const res = await acceptThenCancel(jashim, await request(passenger));
        expect(res.status).toBe(200);
      }
    }

    it('reports how many cancellations have been used', async () => {
      await cancelTrips(1);

      const feed = await jashim.agent.get('/api/v1/driver/requests');

      expect(feed.body.standing).toMatchObject({
        used: 1,
        limit,
        windowHours,
        suspendedUntil: null,
      });
    });

    it('never refuses the cancellation itself', async () => {
      // A driver whose battery has died must always be able to release passengers;
      // the consequence lands on what they accept next.
      await cancelTrips(limit);
    });

    it('stops the driver accepting new trips once the limit is reached', async () => {
      await cancelTrips(limit);

      const res = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: await request(nusrat) });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DRIVER_CANCEL_LIMIT_REACHED');
    });

    it('says when the suspension lifts', async () => {
      await cancelTrips(limit);

      const feed = await jashim.agent.get('/api/v1/driver/requests');
      const until = new Date(feed.body.standing.suspendedUntil as string).getTime();

      // One window after the cancellation that tipped it over.
      const expected = Date.now() + windowHours * 3_600_000;
      expect(Math.abs(until - expected)).toBeLessThan(60_000);
    });

    it('leaves other drivers unaffected', async () => {
      await cancelTrips(limit);

      const res = await kamal.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: await request(nusrat) });

      expect(res.status).toBe(201);
    });

    it('forgets cancellations older than the window', async () => {
      await cancelTrips(limit);

      // Age every cancellation just past the window rather than waiting for it.
      await prisma.pool.updateMany({
        where: { driverId: jashim.id, status: 'CANCELLED' },
        data: { cancelledAt: new Date(Date.now() - (windowHours * 3_600_000 + 60_000)) },
      });

      const feed = await jashim.agent.get('/api/v1/driver/requests');
      expect(feed.body.standing).toMatchObject({ used: 0, suspendedUntil: null });

      const res = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: await request(nusrat) });
      expect(res.status).toBe(201);
    });
  });
});

describe.skipIf(hasDatabase)('driver cancellations (skipped)', () => {
  it('needs a reachable MySQL — run `docker compose up` first', () => {
    expect(hasDatabase).toBe(false);
  });
});
