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

describe.skipIf(!hasDatabase)('driver trip flow', () => {
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

  /** Nusrat and Rafiq pooled in Bullet, 2 of 3 seats. */
  async function pooledTrip(options: { paymentMethod?: 'CASH' | 'TESLAPAY' } = {}) {
    const method = options.paymentMethod ?? 'CASH';

    const nusratRide = await nusrat.agent.post('/api/v1/rides').send({
      pickupAreaId: areas.banani,
      dropoffAreaId: areas.mohakhali,
      paymentMethod: method,
    });
    const rafiqRide = await rafiq.agent.post('/api/v1/rides').send({
      pickupAreaId: areas.banani,
      dropoffAreaId: areas.gulshan1,
      paymentMethod: method,
    });

    const pool = await jashim.agent
      .post('/api/v1/driver/pools')
      .send({ rideRequestId: nusratRide.body.data.id });
    await jashim.agent
      .post(`/api/v1/driver/pools/${pool.body.data.id}/members`)
      .send({ rideRequestId: rafiqRide.body.data.id });

    return {
      poolId: pool.body.data.id as number,
      nusratRideId: nusratRide.body.data.id as number,
      rafiqRideId: rafiqRide.body.data.id as number,
    };
  }

  describe('the full happy path', () => {
    it('walks arrive → start → complete', async () => {
      const { poolId } = await pooledTrip();

      const arrived = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      expect(arrived.status).toBe(200);
      expect(arrived.body.data.status).toBe('DRIVER_ARRIVED');
      expect(arrived.body.data.arrivedAt).toBeTruthy();

      const started = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      expect(started.status).toBe(200);
      expect(started.body.data.status).toBe('STARTED');

      const completed = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);
      expect(completed.status).toBe(200);
      expect(completed.body.data.status).toBe('COMPLETED');
    });

    it('carries every passenger along with the pool', async () => {
      const { poolId, nusratRideId, rafiqRideId } = await pooledTrip();

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      for (const id of [nusratRideId, rafiqRideId]) {
        const ride = await prisma.rideRequest.findUniqueOrThrow({ where: { id: BigInt(id) } });
        expect(ride.status).toBe('DRIVER_ARRIVED');
      }

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      for (const id of [nusratRideId, rafiqRideId]) {
        const ride = await prisma.rideRequest.findUniqueOrThrow({ where: { id: BigInt(id) } });
        expect(ride.status).toBe('COMPLETED');
        expect(ride.completedAt).toBeTruthy();
      }
    });

    it('gives the passenger a full timeline', async () => {
      const { poolId, nusratRideId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      const res = await nusrat.agent.get(`/api/v1/rides/${nusratRideId}`);

      expect(res.body.data.timeline.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'REQUESTED',
        'MATCHED',
        'DRIVER_ARRIVED',
        'STARTED',
        'COMPLETED',
      ]);
    });
  });

  describe('fares lock at departure', () => {
    it('writes finalFarePaisa when the trip starts', async () => {
      const { poolId, nusratRideId, rafiqRideId } = await pooledTrip();

      // Still null while the pool can change.
      let nusratRide = await prisma.rideRequest.findUniqueOrThrow({
        where: { id: BigInt(nusratRideId) },
      });
      expect(nusratRide.finalFarePaisa).toBeNull();

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);

      nusratRide = await prisma.rideRequest.findUniqueOrThrow({
        where: { id: BigInt(nusratRideId) },
      });
      const rafiqRide = await prisma.rideRequest.findUniqueOrThrow({
        where: { id: BigInt(rafiqRideId) },
      });

      // The pooled figures from the README, now immutable.
      expect(nusratRide.finalFarePaisa).toBe(4159n);
      expect(rafiqRide.finalFarePaisa).toBe(4147n);
      // The solo estimate is kept alongside, so the discount stays visible.
      expect(nusratRide.estimatedFarePaisa).toBe(4699n);
    });

    it('closes the pool to new passengers once the driver arrives', async () => {
      const { poolId } = await pooledTrip();
      const shirin = await createShirin(app);
      const shirinRide = await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);

      const res = await jashim.agent
        .post(`/api/v1/driver/pools/${poolId}/members`)
        .send({ rideRequestId: shirinRide.body.data.id });

      // A seat exists, but the Tesla is no longer forming.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POOL_NOT_FORMING');
    });

    it('refuses to start a pool everyone abandoned', async () => {
      const { poolId, nusratRideId, rafiqRideId } = await pooledTrip();
      await nusrat.agent.patch(`/api/v1/rides/${nusratRideId}/cancel`).send({});
      await rafiq.agent.patch(`/api/v1/rides/${rafiqRideId}/cancel`).send({});

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POOL_EMPTY');
    });
  });

  describe('invalid transitions', () => {
    it('refuses to start before arriving', async () => {
      const { poolId } = await pooledTrip();

      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('refuses to complete before starting', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);

      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('refuses to arrive twice', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);

      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);

      expect(res.status).toBe(409);
    });

    it('refuses to complete twice', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      expect(res.status).toBe(409);
    });

    it('refuses to cancel a trip already under way', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);

      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/cancel`).send({});

      expect(res.status).toBe(409);
    });

    it('refuses another driver on every trip control', async () => {
      const { poolId } = await pooledTrip();
      const { createDriver } = await import('../helpers/actors.js');
      const salma = await createDriver(app, {
        name: 'Salma Begum',
        email: 'salma@dhakatesla.test',
        vehicleName: 'Rocket',
        plateNo: 'DHA-TESLA-02',
        capacity: 3,
      });

      for (const action of ['arrive', 'start', 'complete', 'cancel']) {
        const res = await salma.agent.patch(`/api/v1/driver/pools/${poolId}/${action}`).send({});
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('POOL_NOT_FOUND');
      }
    });
  });

  describe('payment settlement', () => {
    it('records cash as collected', async () => {
      const { poolId } = await pooledTrip({ paymentMethod: 'CASH' });
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);

      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      expect(res.body.meta.settlement).toHaveLength(2);
      expect(res.body.meta.settlement.every((l: { status: string }) => l.status === 'PAID')).toBe(
        true,
      );
      const total = res.body.meta.settlement.reduce(
        (sum: number, l: { amountPaisa: number }) => sum + l.amountPaisa,
        0,
      );
      expect(total).toBe(8306); // 83.06 BDT
    });

    it('raises payments only when the trip starts, not when it is requested', async () => {
      const { poolId } = await pooledTrip();
      expect(await prisma.payment.count()).toBe(0);

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);

      // A payment row carrying a figure that could still change would be a receipt
      // for a price nobody agreed to.
      expect(await prisma.payment.count()).toBe(2);
      expect(await prisma.payment.count({ where: { status: 'PENDING' } })).toBe(2);
    });

    it('debits a TeslaPay wallet and writes a ledger entry', async () => {
      const { poolId, nusratRideId } = await pooledTrip({ paymentMethod: 'TESLAPAY' });
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { userId: nusrat.id },
        include: { transactions: true },
      });

      expect(wallet.balancePaisa).toBe(50_000n - 4159n);
      const debit = wallet.transactions.find((t) => t.direction === 'DEBIT');
      expect(debit).toMatchObject({
        amountPaisa: 4159n,
        balanceAfterPaisa: 45_841n,
        rideRequestId: BigInt(nusratRideId),
      });
    });

    it('keeps the ledger and the balance in agreement', async () => {
      const { poolId } = await pooledTrip({ paymentMethod: 'TESLAPAY' });
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { userId: nusrat.id },
        include: { transactions: { orderBy: { id: 'asc' } } },
      });

      // A balance without a matching ledger is unauditable; this is the check that
      // says they have not drifted.
      const replayed = wallet.transactions.reduce(
        (balance, t) => (t.direction === 'CREDIT' ? balance + t.amountPaisa : balance - t.amountPaisa),
        0n,
      );
      expect(replayed).toBe(wallet.balancePaisa);
      expect(wallet.transactions.at(-1)?.balanceAfterPaisa).toBe(wallet.balancePaisa);
    });

    it('completes the trip but marks a payment FAILED when the wallet is short', async () => {
      // Shirin holds 45.00 BDT: enough for a pooled fare, not a solo one.
      const shirin = await createShirin(app);
      const ride = await shirin.agent.post('/api/v1/rides').send({
        pickupAreaId: areas.banani,
        dropoffAreaId: areas.mohakhali,
        paymentMethod: 'TESLAPAY',
      });

      const pool = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: ride.body.data.id });
      const poolId = pool.body.data.id;

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      const res = await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      // Riding solo costs 46.99, which she cannot cover.
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.meta.settlement[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'INSUFFICIENT_WALLET_BALANCE',
        amountPaisa: 4699,
      });

      // Refusing to complete would strand the driver over someone else's balance,
      // with the passenger already delivered.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: shirin.id } });
      expect(wallet.balancePaisa).toBe(4_500n);
      expect(await prisma.walletTransaction.count({ where: { direction: 'DEBIT' } })).toBe(0);
    });

    it('affords the same trip once it is shared', async () => {
      // The pooled fare is 41.47, inside Shirin's 45.00 balance.
      const shirin = await createShirin(app);
      const shirinRide = await shirin.agent.post('/api/v1/rides').send({
        pickupAreaId: areas.banani,
        dropoffAreaId: areas.gulshan1,
        paymentMethod: 'TESLAPAY',
      });
      const nusratRide = await nusrat.agent.post('/api/v1/rides').send({
        pickupAreaId: areas.banani,
        dropoffAreaId: areas.mohakhali,
        paymentMethod: 'CASH',
      });

      const pool = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: shirinRide.body.data.id });
      await jashim.agent
        .post(`/api/v1/driver/pools/${pool.body.data.id}/members`)
        .send({ rideRequestId: nusratRide.body.data.id });

      await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/start`);
      const res = await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/complete`);

      const shirinLine = res.body.meta.settlement.find(
        (l: { passengerName: string }) => l.passengerName === 'Shirin Akter',
      );
      expect(shirinLine).toMatchObject({ status: 'PAID', amountPaisa: 4147 });

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: shirin.id } });
      expect(wallet.balancePaisa).toBe(4_500n - 4_147n);
    });

    it('does not charge a passenger who left before departure', async () => {
      const { poolId, nusratRideId } = await pooledTrip({ paymentMethod: 'TESLAPAY' });
      await nusrat.agent.patch(`/api/v1/rides/${nusratRideId}/cancel`).send({});

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      expect(await prisma.payment.count()).toBe(1);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: nusrat.id } });
      expect(wallet.balancePaisa).toBe(50_000n);
    });
  });

  describe('cancelling a pool', () => {
    it('returns passengers to the queue rather than marking them cancelled', async () => {
      const { poolId, nusratRideId, rafiqRideId } = await pooledTrip();

      const res = await jashim.agent
        .patch(`/api/v1/driver/pools/${poolId}/cancel`)
        .send({ reason: "Bullet's battery died" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.seatsTaken).toBe(0);

      for (const id of [nusratRideId, rafiqRideId]) {
        const ride = await prisma.rideRequest.findUniqueOrThrow({ where: { id: BigInt(id) } });
        // They did not give up, so CANCELLED would be a lie.
        expect(ride.status).toBe('REQUESTED');
        expect(ride.matchedAt).toBeNull();
        expect(ride.cancelledAt).toBeNull();
      }
    });

    it('attributes the requeue to SYSTEM, not to either party', async () => {
      const { poolId, nusratRideId } = await pooledTrip();
      await jashim.agent
        .patch(`/api/v1/driver/pools/${poolId}/cancel`)
        .send({ reason: 'Flat tyre' });

      const res = await nusrat.agent.get(`/api/v1/rides/${nusratRideId}`);
      const last = res.body.data.timeline.at(-1);

      expect(last).toMatchObject({
        toStatus: 'REQUESTED',
        actorRole: 'SYSTEM',
        by: 'System',
      });
      expect(last.note).toContain('Flat tyre');
    });

    it('lets a requeued passenger be picked up by another driver', async () => {
      const { poolId, nusratRideId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/cancel`).send({});

      const { createDriver } = await import('../helpers/actors.js');
      const salma = await createDriver(app, {
        name: 'Salma Begum',
        email: 'salma@dhakatesla.test',
        vehicleName: 'Rocket',
        plateNo: 'DHA-TESLA-02',
        capacity: 3,
        isOnline: true,
      });

      const res = await salma.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: nusratRideId });

      expect(res.status).toBe(201);
      expect(res.body.data.members[0].farePaisa).toBe(4699); // solo again
    });

    it('frees the driver to start a new pool', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/cancel`).send({});

      const shirin = await createShirin(app);
      const ride = await shirin.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.gulshan1 });

      const res = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: ride.body.data.id });

      expect(res.status).toBe(201);
    });

    it('lets the driver go offline again', async () => {
      const { poolId } = await pooledTrip();
      expect((await jashim.agent.patch('/api/v1/driver/status').send({ isOnline: false })).status).toBe(
        409,
      );

      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/cancel`).send({});

      expect((await jashim.agent.patch('/api/v1/driver/status').send({ isOnline: false })).status).toBe(
        200,
      );
    });
  });

  describe('GET /driver/pools — trip history', () => {
    it('reports earnings, seat utilisation and passengers', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/complete`);

      const res = await jashim.agent.get('/api/v1/driver/pools');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        status: 'COMPLETED',
        capacity: 3,
        seatsUsed: 2,
        utilisationPct: 67,
        passengerCount: 2,
        pooled: true,
        earnedPaisa: 8306,
      });
      expect(res.body.data[0].passengers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Nusrat', paymentStatus: 'PAID', farePaisa: 4159 }),
          expect.objectContaining({ name: 'Rafiq', paymentStatus: 'PAID', farePaisa: 4147 }),
        ]),
      );
    });

    it('shows a solo trip as not pooled', async () => {
      const ride = await nusrat.agent
        .post('/api/v1/rides')
        .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
      const pool = await jashim.agent
        .post('/api/v1/driver/pools')
        .send({ rideRequestId: ride.body.data.id });
      await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/arrive`);
      await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/start`);
      await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/complete`);

      const res = await jashim.agent.get('/api/v1/driver/pools');

      expect(res.body.data[0]).toMatchObject({
        pooled: false,
        seatsUsed: 1,
        utilisationPct: 33,
        earnedPaisa: 4699,
      });
    });

    it('lists only this driver\'s trips', async () => {
      const { poolId } = await pooledTrip();
      await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/cancel`).send({});

      const { createDriver } = await import('../helpers/actors.js');
      const salma = await createDriver(app, {
        name: 'Salma Begum',
        email: 'salma@dhakatesla.test',
        vehicleName: 'Rocket',
        plateNo: 'DHA-TESLA-02',
        capacity: 3,
        isOnline: true,
      });

      const res = await salma.agent.get('/api/v1/driver/pools');
      expect(res.body.data).toHaveLength(0);
    });

    it('paginates newest first', async () => {
      for (let i = 0; i < 3; i += 1) {
        const p = await createPassenger(app, {
          name: `Rider ${i}`,
          email: `rider${i}@dhakatesla.test`,
        });
        const ride = await p.agent
          .post('/api/v1/rides')
          .send({ pickupAreaId: areas.banani, dropoffAreaId: areas.mohakhali });
        const pool = await jashim.agent
          .post('/api/v1/driver/pools')
          .send({ rideRequestId: ride.body.data.id });
        await jashim.agent.patch(`/api/v1/driver/pools/${pool.body.data.id}/cancel`).send({});
      }

      const page1 = await jashim.agent.get('/api/v1/driver/pools?limit=2');
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta.nextCursor).toBeTruthy();

      const page2 = await jashim.agent.get(
        `/api/v1/driver/pools?limit=2&cursor=${page1.body.meta.nextCursor}`,
      );
      expect(page2.body.data).toHaveLength(1);
      expect(page1.body.data[0].id).toBeGreaterThan(page1.body.data[1].id);
    });
  });
});

describe.skipIf(hasDatabase)('driver trip flow (skipped)', () => {
  it('needs a reachable MySQL — run `docker compose up` first', () => {
    expect(hasDatabase).toBe(false);
  });
});
