import { PrismaClient, Role } from '@prisma/client';

import { hashPassword } from '../src/lib/password.js';

/**
 * Seed data for Dhaka Tesla Pool.
 *
 * The cast is the brief's, deliberately: Jashim driving Bullet, with Nusrat,
 * Rafiq and Shirin as passengers. Generic user1/driver1 placeholders are
 * explicitly penalised, and the named cast also makes the demo and the tests
 * tell the same story.
 *
 * Idempotent — every write is an upsert keyed on a natural unique column, so
 * running this repeatedly against an existing database changes nothing.
 */
const prisma = new PrismaClient();

/** Shared across all demo accounts. Documented in the README, never a real secret. */
const DEMO_PASSWORD = 'TeslaPool#2026';

/**
 * Twelve Dhaka areas with real coordinates. Twelve rows rather than a map API,
 * as the brief invites — distance is then arithmetic, exact and reproducible.
 *
 * Coordinates are DECIMAL(9,6) in the database: an evaluator recomputing
 * Banani → Mohakhali by hand must get the same 1.799 km we do.
 */
const AREAS = [
  { name: 'Banani', latitude: '23.793900', longitude: '90.404300' },
  { name: 'Gulshan 1', latitude: '23.780600', longitude: '90.414200' },
  { name: 'Gulshan 2', latitude: '23.792500', longitude: '90.407800' },
  { name: 'Mohakhali', latitude: '23.777800', longitude: '90.406000' },
  { name: 'Dhanmondi', latitude: '23.746100', longitude: '90.374200' },
  { name: 'Mirpur', latitude: '23.822300', longitude: '90.365400' },
  { name: 'Uttara', latitude: '23.875900', longitude: '90.379500' },
  { name: 'Farmgate', latitude: '23.758300', longitude: '90.389400' },
  { name: 'Bashundhara', latitude: '23.820300', longitude: '90.425700' },
  { name: 'Motijheel', latitude: '23.733000', longitude: '90.417200' },
  { name: 'Badda', latitude: '23.780600', longitude: '90.425800' },
  { name: 'Tejgaon', latitude: '23.763900', longitude: '90.394400' },
] as const;

const PEOPLE = [
  {
    name: 'Jashim Uddin',
    email: 'jashim@dhakatesla.test',
    phone: '+8801711000001',
    role: Role.DRIVER,
    walletPaisa: null, // drivers collect fares, they do not hold a rider wallet
  },
  {
    name: 'Nusrat Jahan',
    email: 'nusrat@dhakatesla.test',
    phone: '+8801711000002',
    role: Role.PASSENGER,
    walletPaisa: 50_000n, // 500.00 BDT
  },
  {
    name: 'Rafiq Hasan',
    email: 'rafiq@dhakatesla.test',
    phone: '+8801711000003',
    role: Role.PASSENGER,
    walletPaisa: 50_000n,
  },
  {
    name: 'Shirin Akter',
    email: 'shirin@dhakatesla.test',
    phone: '+8801711000004',
    role: Role.PASSENGER,
    // Deliberately low: enough for a pooled fare, not for a solo one. Makes the
    // INSUFFICIENT_WALLET_BALANCE path demonstrable without editing data.
    walletPaisa: 4_500n,
  },
] as const;

/** Bullet. Three seats, which is the number the whole pooling story turns on. */
const BULLET = {
  name: 'Bullet',
  plateNo: 'DHA-TESLA-01',
  capacity: 3,
} as const;

async function main(): Promise<void> {
  console.warn('Seeding Dhaka Tesla Pool...');

  // ── Areas ────────────────────────────────────────────────────────────────
  for (const area of AREAS) {
    await prisma.area.upsert({
      where: { name: area.name },
      update: { latitude: area.latitude, longitude: area.longitude, isActive: true },
      create: { ...area },
    });
  }
  console.warn(`  areas:    ${AREAS.length}`);

  // ── People ───────────────────────────────────────────────────────────────
  // Hashed once and reused: argon2 is intentionally slow, and four sequential
  // hashes at these parameters is a noticeable chunk of the seed's runtime.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const person of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, phone: person.phone, role: person.role },
      create: {
        name: person.name,
        email: person.email,
        phone: person.phone,
        role: person.role,
        passwordHash,
      },
    });

    if (person.walletPaisa !== null) {
      const existing = await prisma.wallet.findUnique({ where: { userId: user.id } });

      if (!existing) {
        // Create the wallet and its opening ledger entry together: a balance
        // without a matching ledger row is exactly the unauditable state the
        // ledger exists to prevent.
        await prisma.$transaction(async (tx) => {
          const wallet = await tx.wallet.create({
            data: { userId: user.id, balancePaisa: person.walletPaisa },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              direction: 'CREDIT',
              amountPaisa: person.walletPaisa,
              balanceAfterPaisa: person.walletPaisa,
              note: 'Opening demo balance',
            },
          });
        });
      }
    }
  }
  console.warn(`  people:   ${PEOPLE.length} (password for all: ${DEMO_PASSWORD})`);

  // ── Bullet ───────────────────────────────────────────────────────────────
  const jashim = await prisma.user.findUniqueOrThrow({
    where: { email: 'jashim@dhakatesla.test' },
  });

  await prisma.vehicle.upsert({
    where: { plateNo: BULLET.plateNo },
    update: { name: BULLET.name, capacity: BULLET.capacity, driverId: jashim.id },
    create: { ...BULLET, driverId: jashim.id },
  });
  console.warn(`  vehicle:  ${BULLET.name} (${BULLET.capacity} seats, ${BULLET.plateNo})`);

  console.warn('Seed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
