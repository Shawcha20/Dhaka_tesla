import type { Express } from 'express';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  createJashim,
  createNusrat,
  createPassenger,
  createRafiq,
  createShirin,
  type Actor,
  type DriverActor,
} from '../helpers/actors.js';
import { databaseReachable, resetDatabase, seedAreas, type SeededAreas } from '../helpers/db.js';

const hasDatabase = await databaseReachable();

/** `seats_taken` must always equal the seats held by active members. */
async function reconcileSeats(poolId: bigint): Promise<{ counter: number; actual: number }> {
  const pool = await prisma.pool.findUniqueOrThrow({ where: { id: poolId } });
  const sum = await prisma.poolMember.aggregate({
    where: { poolId, leftAt: null },
    _sum: { seats: true },
  });
  return { counter: pool.seatsTaken, actual: sum._sum.seats ?? 0 };
}

describe.skipIf(!hasDatabase)('pooling and capacity', () => {
  let app: Express;
  let areas: SeededAreas;
  let jashim: DriverActor;
  let nusrat: Actor;
  let rafiq: Actor;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    areas = await seedAreas();
    jashim = await createJashim(app);
    nusrat = await createNusrat(app);
    rafiq = await createRafiq(app);
  });

  /** Nusrat books Banani → Mohakhali. */
  async function nusratRequests(seats = 1): Promise<number> {
    const res = await nusrat.agent
      .post('/api/v1/rides')
      .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali, seats });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  /** Rafiq books Banani → Gulshan 1 — compatible, 28.7° away. */
  async function rafiqRequests(seats = 1): Promise<number> {
    const res = await rafiq.agent
      .post('/api/v1/rides')
      .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1, seats });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  async function openPoolWithNusrat(): Promise<{ poolId: number; rideId: number }> {
    const rideId = await nusratRequests();
    const res = await jashim.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });
    expect(res.status).toBe(201);
    return { poolId: res.body.data.id, rideId };
  }

  describe('opening a pool', () => {
    it('seats the first passenger and leaves them on the solo fare', async () => {
      const rideId = await nusratRequests();

      const res = await jashim.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'FORMING',
        seatsTaken: 1,
        capacity: 3,
        freeSeats: 2,
      });
      // Alone so far, so no discount: the discount is a fact about a shared trip.
      expect(res.body.data.members[0].farePaisa).toBe(4699);
    });

    it('marks the ride MATCHED and records who did it', async () => {
      const { rideId } = await openPoolWithNusrat();

      const ride = await nusrat.agent.get(`/api/v1/rides/${rideId}`);
      expect(ride.body.data.status).toBe('MATCHED');
      expect(ride.body.data.timeline.at(-1)).toMatchObject({
        fromStatus: 'REQUESTED',
        toStatus: 'MATCHED',
        by: 'Jashim Uddin',
        actorRole: 'DRIVER',
      });
    });

    it('refuses an offline driver', async () => {
      const rideId = await nusratRequests();
      await jashim.agent.patch('/api/v1/driver/status').send({ isOnline: false });

      const res = await jashim.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('VEHICLE_OFFLINE');
    });

    it('refuses a second pool while one is active', async () => {
      await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();

      const res = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: rafiqRide });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DRIVER_HAS_ACTIVE_POOL');
    });

    it('refuses a request needing more seats than the vehicle has', async () => {
      const rideId = await nusratRequests(4); // Bullet seats 3

      const res = await jashim.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POOL_CAPACITY_EXCEEDED');
    });

    it('refuses a passenger another driver already took', async () => {
      const rideId = await nusratRequests();
      await jashim.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });

      const karim = await createPassenger(app, {
        name: 'Karim Mia',
        email: 'karim.driver@dhakatesla.test',
      });
      void karim;
      const otherDriver = await prisma.user.findFirst({ where: { role: 'DRIVER' } });
      expect(otherDriver).not.toBeNull();

      // Same request, fresh driver.
      const { createDriver } = await import('../helpers/actors.js');
      const salma = await createDriver(app, {
        name: 'Salma Begum',
        email: 'salma@dhakatesla.test',
        vehicleName: 'Rocket',
        plateNo: 'DHA-TESLA-02',
        capacity: 3,
        isOnline: true,
      });

      const res = await salma.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RIDE_ALREADY_MATCHED');
    });
  });

  describe('the brief\'s pooling scenario', () => {
    it('pools Rafiq with Nusrat and re-prices both', async () => {
      const { poolId, rideId: nusratRide } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ seatsTaken: 2, capacity: 3, freeSeats: 1 });

      // The headline behaviour: adding Rafiq changes *Nusrat's* price too.
      const fares = new Map<number, number>(
        res.body.data.members.map((m: { rideRequestId: number; farePaisa: number }) => [
          m.rideRequestId,
          m.farePaisa,
        ]),
      );
      expect(fares.get(nusratRide)).toBe(4159); // was 4699
      expect(fares.get(rafiqRide)).toBe(4147);
      expect(res.body.data.totalFarePaisa).toBe(8306); // 83.06 BDT for one trip
    });

    it('shows Nusrat her own new fare and Rafiq as a companion', async () => {
      const { poolId, rideId: nusratRide } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const res = await nusrat.agent.get(`/api/v1/rides/${nusratRide}`);

      expect(res.body.data.currentFarePaisa).toBe(4159);
      expect(res.body.data.pool.companions).toEqual([
        { name: 'Rafiq', dropoffArea: 'Gulshan 1', seats: 1 },
      ]);
    });

    it('never exposes a companion\'s fare or contact details', async () => {
      const { poolId, rideId: nusratRide } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const res = await nusrat.agent.get(`/api/v1/rides/${nusratRide}`);
      const companions = JSON.stringify(res.body.data.pool.companions);

      // Nusrat may know she is sharing with Rafiq and where he is going. She may
      // not know his fare, email or phone.
      expect(companions).not.toContain('4147');
      expect(companions).not.toContain('rafiq@');
      expect(companions).not.toContain('+8801711000003');
    });

    it('refuses a passenger heading the opposite way', async () => {
      const { poolId } = await openPoolWithNusrat();
      const uttara = await rafiq.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.uttara });

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: uttara.body.data.id });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ROUTE_NOT_COMPATIBLE');
      // The refusal is inspectable: 170.1° against a 45° limit.
      expect(res.body.error.message).toContain('170.1');
    });

    it('refuses a passenger waiting somewhere else', async () => {
      const { poolId } = await openPoolWithNusrat();
      const elsewhere = await rafiq.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.dhanmondi, dropoffAreaId: areas.mohakhali });

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: elsewhere.body.data.id });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ROUTE_NOT_COMPATIBLE');
    });
  });

  describe('capacity', () => {
    it('fills Bullet to exactly three seats', async () => {
      const { poolId } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const shirin = await createShirin(app);
      const shirinRide = await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: shirinRide.body.data.id });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ seatsTaken: 3, capacity: 3, freeSeats: 0 });
    });

    it('refuses a two-seat request when only one seat is left', async () => {
      const { poolId } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const shirin = await createShirin(app);
      const shirinRide = await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1, seats: 2 });

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: shirinRide.body.data.id });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POOL_CAPACITY_EXCEEDED');
      // And nothing was taken.
      expect((await reconcileSeats(BigInt(poolId))).counter).toBe(2);
    });

    it('refuses a fourth passenger outright', async () => {
      const { poolId } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });
      const shirin = await createShirin(app);
      const shirinRide = await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: shirinRide.body.data.id });

      const karim = await createPassenger(app, {
        name: 'Karim Mia',
        email: 'karim@dhakatesla.test',
      });
      const karimRide = await karim.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: karimRide.body.data.id });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POOL_CAPACITY_EXCEEDED');
      expect((await reconcileSeats(BigInt(poolId))).counter).toBe(3);
    });

    it('rejects a raw overbooking UPDATE at the database level', async () => {
      const { poolId } = await openPoolWithNusrat();

      /**
       * Bypasses the application entirely. This proves the CHECK constraint is
       * live — which also proves the server is MySQL 8.0.16+, since earlier
       * versions parse CHECK and silently ignore it. If this test ever passes
       * without throwing, the last line of defence is gone.
       */
      await expect(
        prisma.$executeRawUnsafe(`UPDATE pools SET seats_taken = 99 WHERE id = ${poolId}`),
      ).rejects.toThrow();

      expect((await reconcileSeats(BigInt(poolId))).counter).toBe(1);
    });
  });

  describe('the contested seat', () => {
    it('gives the last seat to exactly one of two simultaneous claims', async () => {
      // Bullet has one seat left, and two passengers want it at the same instant.
      const { poolId } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const shirin = await createShirin(app);
      const karim = await createPassenger(app, {
        name: 'Karim Mia',
        email: 'karim@dhakatesla.test',
      });

      const [shirinRide, karimRide] = await Promise.all([
        shirin.agent
          .post('/api/v1/rides')
          .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 }),
        karim.agent
          .post('/api/v1/rides')
          .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 }),
      ]);

      // Fired together, with no coordination between them.
      const [a, b] = await Promise.all([
        jashim.agent
          .post(`/api/v1/driver/pools/${poolId}/members`)
          .send({ rideRequestId: shirinRide.body.data.id }),
        jashim.agent
          .post(`/api/v1/driver/pools/${poolId}/members`)
          .send({ rideRequestId: karimRide.body.data.id }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe('POOL_CAPACITY_EXCEEDED');

      // Capacity respected, and the counter agrees with the membership rows.
      const { counter, actual } = await reconcileSeats(BigInt(poolId));
      expect(counter).toBe(3);
      expect(actual).toBe(3);
      expect(await prisma.poolMember.count({ where: { poolId: BigInt(poolId), leftAt: null } })).toBe(3);
    });

    it('never overbooks under five simultaneous claims for one seat', async () => {
      const { poolId } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const contenders = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createPassenger(app, {
            name: `Contender ${i}`,
            email: `contender${i}@dhakatesla.test`,
          }),
        ),
      );

      const rides = await Promise.all(
        contenders.map((c) =>
          c.agent
            .post('/api/v1/rides')
            .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 }),
        ),
      );

      const results = await Promise.all(
        rides.map((r) =>
          jashim.agent
            .post(`/api/v1/driver/pools/${poolId}/members`)
            .send({ rideRequestId: r.body.data.id }),
        ),
      );

      // Exactly one winner, whatever the interleaving.
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);

      const { counter, actual } = await reconcileSeats(BigInt(poolId));
      expect(counter).toBe(3);
      expect(actual).toBe(3);
    });

    it('lets exactly one of two drivers take the same open request', async () => {
      const rideId = await nusratRequests();
      const { createDriver } = await import('../helpers/actors.js');
      const salma = await createDriver(app, {
        name: 'Salma Begum',
        email: 'salma@dhakatesla.test',
        vehicleName: 'Rocket',
        plateNo: 'DHA-TESLA-02',
        capacity: 3,
        isOnline: true,
      });

      const [a, b] = await Promise.all([
        jashim.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId }),
        salma.agent.post('/api/v1/driver/pools').send({ rideRequestId: rideId }),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      // One membership only — the unique index on ride_request_id is the backstop.
      expect(await prisma.poolMember.count({ where: { rideRequestId: BigInt(rideId) } })).toBe(1);
    });

    it('refuses to seat the same request twice', async () => {
      const { poolId } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      const again = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      expect(again.status).toBe(409);
      expect((await reconcileSeats(BigInt(poolId))).counter).toBe(2);
    });
  });

  describe('leaving a pool', () => {
    it('releases the seat and removes the remaining passenger\'s discount', async () => {
      const { poolId, rideId: nusratRide } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      await nusrat.agent.patch(`/api/v1/rides/${nusratRide}/cancel`).send({ reason: 'Found a CNG' });

      const pool = await jashim.agent.get(`/api/v1/driver/pools/${poolId}`);

      expect(pool.body.data.seatsTaken).toBe(1);
      const rafiqMember = pool.body.data.members.find(
        (m: { rideRequestId: number }) => m.rideRequestId === rafiqRide,
      );
      // Alone again, so back to the solo fare.
      expect(rafiqMember.farePaisa).toBe(4684);

      const { counter, actual } = await reconcileSeats(BigInt(poolId));
      expect(counter).toBe(actual);
    });

    it('keeps the departed member on record', async () => {
      const { poolId, rideId: nusratRide } = await openPoolWithNusrat();
      await nusrat.agent.patch(`/api/v1/rides/${nusratRide}/cancel`).send({});

      const pool = await jashim.agent.get(`/api/v1/driver/pools/${poolId}`);
      const member = pool.body.data.members.find(
        (m: { rideRequestId: number }) => m.rideRequestId === nusratRide,
      );

      // Deleting the row would erase the fact she was ever aboard.
      expect(member).toBeDefined();
      expect(member.active).toBe(false);
      expect(member.leftAt).toBeTruthy();
    });

    it('frees the seat for someone else', async () => {
      const { poolId, rideId: nusratRide } = await openPoolWithNusrat();
      const rafiqRide = await rafiqRequests();
      await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });
      const shirin = await createShirin(app);
      const shirinRide = await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1, seats: 2 });

      // Two seats do not fit alongside Nusrat and Rafiq...
      const before = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: shirinRide.body.data.id });
      expect(before.status).toBe(409);

      // ...but they do once Nusrat leaves.
      await nusrat.agent.patch(`/api/v1/rides/${nusratRide}/cancel`).send({});
      const after = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: shirinRide.body.data.id });

      expect(after.status).toBe(201);
      expect(after.body.data.seatsTaken).toBe(3);
    });
  });

  describe('ownership', () => {
    it('hides another driver\'s pool behind a 404', async () => {
      const { poolId } = await openPoolWithNusrat();
      const { createDriver } = await import('../helpers/actors.js');
      const salma = await createDriver(app, {
        name: 'Salma Begum',
        email: 'salma@dhakatesla.test',
        vehicleName: 'Rocket',
        plateNo: 'DHA-TESLA-02',
        capacity: 3,
      });

      const read = await salma.agent.get(`/api/v1/driver/pools/${poolId}`);
      const rafiqRide = await rafiqRequests();
      const write = await salma.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: rafiqRide });

      expect(read.status).toBe(404);
      expect(write.status).toBe(404);
    });

    it('refuses a passenger on every driver route', async () => {
      // Thunks, not eagerly-created promises. Supertest binds an ephemeral server
      // per request, so building them all up front starts four servers at once and
      // the later ones are already closed by the time they are awaited.
      const calls = [
        () => nusrat.agent.get('/api/v1/driver/requests'),
        () => nusrat.agent.get('/api/v1/driver/pools/current'),
        () => nusrat.agent.get('/api/v1/driver/pools'),
        () => nusrat.agent.patch('/api/v1/driver/status').send({ isOnline: true }),
        () => nusrat.agent.post('/api/v1/driver/pools').send({ rideRequestId: 1 }),
      ];

      for (const call of calls) {
        const res = await call();
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
      }
    });
  });

  describe('GET /driver/requests', () => {
    it('explains why each request cannot be pooled instead of hiding it', async () => {
      const { poolId } = await openPoolWithNusrat();
      void poolId;
      await rafiqRequests(); // compatible
      const shirin = await createShirin(app);
      await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.uttara }); // wrong way

      const res = await jashim.agent.get('/api/v1/driver/requests');

      expect(res.status).toBe(200);
      expect(res.body.pool).toMatchObject({ seatsTaken: 1, capacity: 3 });

      const byReason = new Map(
        res.body.data.map((r: { dropoffArea: { name: string }; poolable: unknown }) => [
          r.dropoffArea.name,
          r.poolable,
        ]),
      );
      expect(byReason.get('Gulshan 1')).toMatchObject({ eligible: true, reason: null });
      expect(byReason.get('Uttara')).toMatchObject({
        eligible: false,
        reason: 'ROUTE_NOT_COMPATIBLE',
      });
    });

    it('reports the bearing difference it used to decide', async () => {
      await openPoolWithNusrat();
      await rafiqRequests();

      const res = await jashim.agent.get('/api/v1/driver/requests');
      const rafiqEntry = res.body.data.find(
        (r: { dropoffArea: { name: string } }) => r.dropoffArea.name === 'Gulshan 1',
      );

      expect(rafiqEntry.poolable.bearingDiffDeg).toBeCloseTo(28.7, 1);
    });

    it('orders oldest-waiting first and reports the wait', async () => {
      await nusratRequests();
      await rafiqRequests();

      const res = await jashim.agent.get('/api/v1/driver/requests');

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].dropoffArea.name).toBe('Mohakhali');
      expect(res.body.data[0].waitingSeconds).toBeGreaterThanOrEqual(0);
    });

    it('quotes both the solo and the pooled fare', async () => {
      await nusratRequests();

      const res = await jashim.agent.get('/api/v1/driver/requests');

      expect(res.body.data[0].estimatedFarePaisa).toBe(4699);
      expect(res.body.data[0].pooledFarePaisa).toBe(4159);
    });

    it('drops already-pooled requests from the feed', async () => {
      await openPoolWithNusrat();

      const res = await jashim.agent.get('/api/v1/driver/requests');

      expect(res.body.data).toHaveLength(0);
    });

    it('narrows to poolable requests on request', async () => {
      await openPoolWithNusrat();
      await rafiqRequests();
      const shirin = await createShirin(app);
      await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.uttara });

      const res = await jashim.agent.get('/api/v1/driver/requests?poolableOnly=true');

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].dropoffArea.name).toBe('Gulshan 1');
    });
  });

  describe('PATCH /driver/status', () => {
    it('toggles online and offline', async () => {
      const off = await jashim.agent.patch('/api/v1/driver/status').send({ isOnline: false });
      expect(off.body.data.isOnline).toBe(false);

      const on = await jashim.agent.patch('/api/v1/driver/status').send({ isOnline: true });
      expect(on.body.data.isOnline).toBe(true);
    });

    it('refuses to go offline mid-trip', async () => {
      await openPoolWithNusrat();

      const res = await jashim.agent.patch('/api/v1/driver/status').send({ isOnline: false });

      // A driver who could vanish while carrying someone would leave that ride
      // unresolvable.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POOL_IN_PROGRESS');
    });
  });
});

describe.skipIf(hasDatabase)('pooling (skipped)', () => {
  it('needs a reachable MySQL — run `docker compose up` first', () => {
    expect(hasDatabase).toBe(false);
  });
});
