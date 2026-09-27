import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createJashim, createNusrat, createRafiq } from '../helpers/actors.js';
import { databaseReachable, resetDatabase, seedAreas } from '../helpers/db.js';

const hasDatabase = await databaseReachable();

/** Enough attempts that a real interleaving turns up, if one is possible. */
const ROUNDS = 12;

/**
 * A passenger and the driver acting on the same trip at the same instant.
 *
 * The seat-claim race is covered in pooling.test.ts. This is the other one: Nusrat
 * presses Cancel while Jashim presses Start. Either outcome is fine — she cancels
 * and the trip leaves without her, or the trip starts and her cancel is refused —
 * but it has to be exactly one of them, all the way down: her status, her seat,
 * her fare and whether she is charged must all tell the same story.
 */
describe.skipIf(!hasDatabase)('lifecycle races', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it(
    'resolves a cancel racing a start to exactly one consistent outcome',
    async () => {
      const outcomes = { cancelled: 0, started: 0 };

      for (let round = 0; round < ROUNDS; round += 1) {
        await resetDatabase();
        const areas = await seedAreas();
        const jashim = await createJashim(app);
        const nusrat = await createNusrat(app);
        const rafiq = await createRafiq(app);

        const nusratRide = await nusrat.agent.post('/api/v1/rides').send({
          pickupAreaId: areas.banani,
          dropoffAreaId: areas.mohakhali,
          paymentMethod: 'CASH',
        });
        const rafiqRide = await rafiq.agent.post('/api/v1/rides').send({
          pickupAreaId: areas.banani,
          dropoffAreaId: areas.gulshan1,
          paymentMethod: 'CASH',
        });
        const pool = await jashim.agent
          .post('/api/v1/driver/pools')
          .send({ rideRequestId: nusratRide.body.data.id });
        const poolId = pool.body.data.id as number;
        await jashim.agent
          .post(`/api/v1/driver/pools/${poolId}/members`)
          .send({ rideRequestId: rafiqRide.body.data.id });
        await jashim.agent.patch(`/api/v1/driver/pools/${poolId}/arrive`);

        const nusratRideId = BigInt(nusratRide.body.data.id as number);

        // The two presses, as close together as the test can make them.
        const [cancel, start] = await Promise.all([
          nusrat.agent.patch(`/api/v1/rides/${nusratRideId}/cancel`).send({}),
          jashim.agent.patch(`/api/v1/driver/pools/${poolId}/start`),
        ]);

        // Neither side may see an internal error: losing a race is a normal
        // answer, not a crash.
        expect(cancel.status, JSON.stringify(cancel.body)).not.toBe(500);
        expect(start.status, JSON.stringify(start.body)).toBe(200);

        const ride = await prisma.rideRequest.findUniqueOrThrow({
          where: { id: nusratRideId },
          select: {
            status: true,
            finalFarePaisa: true,
            poolMembers: { select: { leftAt: true } },
            payment: { select: { id: true } },
          },
        });
        const poolRow = await prisma.pool.findUniqueOrThrow({
          where: { id: BigInt(poolId) },
          select: { seatsTaken: true, members: { where: { leftAt: null }, select: { seats: true } } },
        });

        // Seats taken always equals the seats of whoever is actually aboard.
        const aboard = poolRow.members.reduce((sum, m) => sum + m.seats, 0);
        expect(poolRow.seatsTaken).toBe(aboard);

        if (cancel.status === 200) {
          outcomes.cancelled += 1;
          expect(ride.status).toBe('CANCELLED');
          expect(ride.poolMembers[0]?.leftAt).not.toBeNull();
          // Cancelled before departure: never charged, never given a locked fare.
          expect(ride.payment).toBeNull();
          expect(ride.finalFarePaisa).toBeNull();
          expect(poolRow.seatsTaken).toBe(1);
        } else {
          outcomes.started += 1;
          expect(cancel.status).toBe(409);
          expect(ride.status).toBe('STARTED');
          expect(ride.poolMembers[0]?.leftAt).toBeNull();
          expect(ride.payment).not.toBeNull();
          expect(poolRow.seatsTaken).toBe(2);
        }
      }

      // Not asserted — which side wins is timing — but worth seeing when it runs.
      console.info('cancel vs start outcomes:', outcomes);
    },
    120_000,
  );
});

describe.skipIf(hasDatabase)('lifecycle races (skipped)', () => {
  it('needs a reachable MySQL — run `docker compose up` first', () => {
    expect(hasDatabase).toBe(false);
  });
});
