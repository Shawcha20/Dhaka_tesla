/**
 * End-to-end walkthrough of the brief's Banani scenario against a running API.
 *
 *   docker compose up -d
 *   node backend/scripts/demo-flow.mjs
 *
 * Nusrat books Banani → Mohakhali. Rafiq books Banani → Gulshan 1. Jashim sees
 * both, pools them into Bullet, and drives the trip to completion. Shirin then
 * tries to claim a seat that no longer exists.
 *
 * Useful for three things: confirming a fresh deployment actually works, walking
 * through the product without a UI, and rehearsing the demo video.
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';
/** Health probes live outside the version prefix, so they need the bare origin. */
const ORIGIN = new URL(BASE).origin;
const PASSWORD = 'TeslaPool#2026';

const taka = (paisa) => `${(paisa / 100).toFixed(2)} BDT`;

let step = 0;
const say = (msg) => console.log(`\n${String(++step).padStart(2, '0')}. ${msg}`);
const detail = (msg) => console.log(`    ${msg}`);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json, headers: res.headers };
}

async function signIn(email) {
  const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  // The access token also comes back as an httpOnly cookie; this reads it out so
  // the script can use the Authorization header instead of a cookie jar.
  const raw = res.headers.getSetCookie?.() ?? [];
  const token = raw
    .find((c) => c.startsWith('dtp_access='))
    ?.split(';')[0]
    ?.slice('dtp_access='.length);
  if (!token) throw new Error('no access cookie returned');
  return token;
}

function expect(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/**
 * Clears anything left over from a previous run, so this script is re-runnable
 * against the same database. One active ride per passenger and one active pool per
 * driver are enforced rules, so without this a second run fails immediately.
 */
async function resetActors(driverToken, passengerTokens) {
  const current = await call('GET', '/driver/pools/current', { token: driverToken });
  if (current.body?.data) {
    await call('PATCH', `/driver/pools/${current.body.data.id}/cancel`, {
      token: driverToken,
      body: { reason: 'Clearing state before demo run' },
    });
  }

  for (const token of passengerTokens) {
    const mine = await call('GET', '/rides/mine?limit=50', { token });
    const active = (mine.body?.data ?? []).filter((r) =>
      ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED'].includes(r.status),
    );
    for (const ride of active) {
      await call('PATCH', `/rides/${ride.id}/cancel`, {
        token,
        body: { reason: 'Clearing state before demo run' },
      });
    }
  }
}

async function main() {
  say('Checking the API is up');
  const ready = await fetch(`${ORIGIN}/ready`).then((r) => r.json());
  detail(`readiness: ${JSON.stringify(ready.data)}`);
  expect(ready.data?.status === 'ready', 'API is not ready — is docker compose up?');

  say('Loading the Dhaka areas');
  const areas = await call('GET', '/areas');
  const byName = new Map(areas.body.data.map((a) => [a.name, a.id]));
  detail(`${areas.body.data.length} areas seeded`);
  const banani = byName.get('Banani');
  const mohakhali = byName.get('Mohakhali');
  const gulshan1 = byName.get('Gulshan 1');
  expect(banani && mohakhali && gulshan1, 'expected Banani, Mohakhali and Gulshan 1');

  say('Signing everyone in');
  const [jashim, nusrat, rafiq, shirin] = await Promise.all([
    signIn('jashim@dhakatesla.test'),
    signIn('nusrat@dhakatesla.test'),
    signIn('rafiq@dhakatesla.test'),
    signIn('shirin@dhakatesla.test'),
  ]);
  detail('Jashim (driver), Nusrat, Rafiq, Shirin (passengers)');

  await resetActors(jashim, [nusrat, rafiq, shirin]);
  detail('cleared any state left by a previous run');

  say('Nusrat prices Banani to Mohakhali before committing');
  const quote = await call('POST', '/rides/quote', {
    token: nusrat,
    body: { pickupAreaId: banani, dropoffAreaId: mohakhali, seats: 1 },
  });
  detail(`distance ${quote.body.data.distanceKm} km`);
  detail(`alone ${taka(quote.body.data.soloFarePaisa)}, shared ${taka(quote.body.data.estimatedPooledFarePaisa)}`);

  say('Nusrat requests the ride, paying by TeslaPay');
  const nusratRide = await call('POST', '/rides', {
    token: nusrat,
    body: { pickupAreaId: banani, dropoffAreaId: mohakhali, seats: 1, paymentMethod: 'TESLAPAY' },
  });
  expect(nusratRide.status === 201, `expected 201, got ${nusratRide.status}`);
  detail(`ride #${nusratRide.body.data.id} — ${nusratRide.body.data.status}, quoted ${taka(nusratRide.body.data.estimatedFarePaisa)}`);

  say('Two minutes later Rafiq requests Banani to Gulshan 1');
  const rafiqRide = await call('POST', '/rides', {
    token: rafiq,
    body: { pickupAreaId: banani, dropoffAreaId: gulshan1, seats: 1, paymentMethod: 'CASH' },
  });
  detail(`ride #${rafiqRide.body.data.id} — quoted ${taka(rafiqRide.body.data.estimatedFarePaisa)}`);

  say('Jashim goes online and looks at what is waiting');
  await call('PATCH', '/driver/status', { token: jashim, body: { isOnline: true } });
  const feed = await call('GET', '/driver/requests', { token: jashim });
  for (const r of feed.body.data) {
    const p = r.poolable;
    detail(
      `${r.passenger.name} → ${r.dropoffArea.name}: ${r.seats} seat, ${taka(r.pooledFarePaisa)} if shared` +
        `, bearing ${r.bearingDeg}°` +
        (p.eligible ? ' — poolable' : ` — not poolable (${p.reason})`),
    );
  }

  say('Jashim accepts Nusrat, opening a pool in Bullet');
  const pool = await call('POST', '/driver/pools', {
    token: jashim,
    body: { rideRequestId: nusratRide.body.data.id },
  });
  expect(pool.status === 201, `expected 201, got ${pool.status} ${JSON.stringify(pool.body)}`);
  const poolId = pool.body.data.id;
  detail(`pool #${poolId} — ${pool.body.data.seatsTaken}/${pool.body.data.capacity} seats`);
  detail(`Nusrat alone still pays ${taka(pool.body.data.members[0].farePaisa)}`);

  say('Jashim checks whether Rafiq can share the ride');
  const recheck = await call('GET', '/driver/requests', { token: jashim });
  const rafiqEntry = recheck.body.data.find((r) => r.id === rafiqRide.body.data.id);
  detail(
    `Rafiq: ${rafiqEntry.poolable.eligible ? 'compatible' : 'incompatible'}` +
      `, ${rafiqEntry.poolable.bearingDiffDeg}° apart from the pool`,
  );

  say('Jashim adds Rafiq — and both fares change');
  const pooled = await call('POST', `/driver/pools/${poolId}/members`, {
    token: jashim,
    body: { rideRequestId: rafiqRide.body.data.id },
  });
  expect(pooled.status === 201, `expected 201, got ${pooled.status} ${JSON.stringify(pooled.body)}`);
  detail(`pool #${poolId} — ${pooled.body.data.seatsTaken}/${pooled.body.data.capacity} seats`);
  for (const m of pooled.body.data.members) {
    detail(`${m.passenger.name} → ${m.dropoffArea.name}: now ${taka(m.farePaisa)}`);
  }
  detail(`Jashim collects ${taka(pooled.body.data.totalFarePaisa)} for one trip`);

  say('Nusrat sees her own new price, and who she is sharing with');
  const nusratView = await call('GET', `/rides/${nusratRide.body.data.id}`, { token: nusrat });
  detail(`her fare: ${taka(nusratView.body.data.currentFarePaisa)} (quoted ${taka(nusratView.body.data.estimatedFarePaisa)})`);
  detail(`companions: ${JSON.stringify(nusratView.body.data.pool.companions)}`);
  expect(
    !JSON.stringify(nusratView.body.data.pool.companions).includes('4147'),
    "a companion's fare must never be exposed",
  );

  say('Shirin tries to claim two seats — only one is left');
  const shirinRide = await call('POST', '/rides', {
    token: shirin,
    body: { pickupAreaId: banani, dropoffAreaId: gulshan1, seats: 2 },
  });
  const refused = await call('POST', `/driver/pools/${poolId}/members`, {
    token: jashim,
    body: { rideRequestId: shirinRide.body.data.id },
  });
  detail(`${refused.status} ${refused.body.error.code} — ${refused.body.error.message}`);
  expect(refused.status === 409, 'overbooking must be refused');

  say('Jashim arrives, starts the trip — fares lock here — and completes it');
  await call('PATCH', `/driver/pools/${poolId}/arrive`, { token: jashim });
  const started = await call('PATCH', `/driver/pools/${poolId}/start`, { token: jashim });
  detail(`pool status: ${started.body.data.status}`);
  const done = await call('PATCH', `/driver/pools/${poolId}/complete`, { token: jashim });
  detail(`pool status: ${done.body.data.status}`);
  for (const line of done.body.meta.settlement) {
    detail(
      `${line.passengerName}: ${taka(line.amountPaisa)} by ${line.method} — ${line.status}` +
        (line.failureReason ? ` (${line.failureReason})` : ''),
    );
  }

  say("Nusrat's ride, start to finish");
  const finalView = await call('GET', `/rides/${nusratRide.body.data.id}`, { token: nusrat });
  detail(`final fare: ${taka(finalView.body.data.finalFarePaisa)}`);
  for (const e of finalView.body.data.timeline) {
    detail(`${e.at} ${e.toStatus.padEnd(15)} by ${e.by}`);
  }

  say("Jashim's trip history");
  const history = await call('GET', '/driver/pools', { token: jashim });
  for (const trip of history.body.data) {
    detail(
      `trip #${trip.id}: ${trip.status}, ${trip.passengerCount} passenger(s), ` +
        `${trip.seatsUsed}/${trip.capacity} seats (${trip.utilisationPct}%), earned ${taka(trip.earnedPaisa)}`,
    );
  }

  console.log('\nDemo flow completed successfully.\n');
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
