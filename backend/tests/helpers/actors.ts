import type { Express } from 'express';
import request from 'supertest';

import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';

export const DEMO_PASSWORD = 'TeslaPool#2026';

/**
 * The brief's cast, created directly rather than through the API.
 *
 * Drivers cannot self-register (onboarding needs vehicle verification), so they
 * have to be inserted; passengers go through the same path for symmetry and speed
 * — argon2 is deliberately slow, so the hash is computed once and reused.
 */
let cachedHash: string | undefined;
async function passwordHash(): Promise<string> {
  cachedHash ??= await hashPassword(DEMO_PASSWORD);
  return cachedHash;
}

export interface Actor {
  id: bigint;
  email: string;
  name: string;
  /** A supertest agent already signed in as this person, cookies and all. */
  agent: ReturnType<typeof request.agent>;
}

async function signIn(app: Express, email: string): Promise<Actor['agent']> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ email, password: DEMO_PASSWORD });

  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export async function createPassenger(
  app: Express,
  options: { name: string; email: string; phone?: string; walletPaisa?: bigint },
): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      name: options.name,
      email: options.email,
      ...(options.phone ? { phone: options.phone } : {}),
      passwordHash: await passwordHash(),
      role: 'PASSENGER',
    },
  });

  await prisma.wallet.create({
    data: { userId: user.id, balancePaisa: options.walletPaisa ?? 50_000n },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    agent: await signIn(app, user.email),
  };
}

export interface DriverActor extends Actor {
  vehicleId: bigint;
}

export async function createDriver(
  app: Express,
  options: {
    name: string;
    email: string;
    vehicleName: string;
    plateNo: string;
    capacity: number;
    isOnline?: boolean;
  },
): Promise<DriverActor> {
  const user = await prisma.user.create({
    data: {
      name: options.name,
      email: options.email,
      passwordHash: await passwordHash(),
      role: 'DRIVER',
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      driverId: user.id,
      name: options.vehicleName,
      plateNo: options.plateNo,
      capacity: options.capacity,
      isOnline: options.isOnline ?? true,
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    vehicleId: vehicle.id,
    agent: await signIn(app, user.email),
  };
}

/** Jashim and Bullet, three seats, online. */
export function createJashim(app: Express): Promise<DriverActor> {
  return createDriver(app, {
    name: 'Jashim Uddin',
    email: 'jashim@dhakatesla.test',
    vehicleName: 'Bullet',
    plateNo: 'DHA-TESLA-01',
    capacity: 3,
    isOnline: true,
  });
}

export function createNusrat(app: Express): Promise<Actor> {
  return createPassenger(app, {
    name: 'Nusrat Jahan',
    email: 'nusrat@dhakatesla.test',
    phone: '+8801711000002',
  });
}

export function createRafiq(app: Express): Promise<Actor> {
  return createPassenger(app, {
    name: 'Rafiq Hasan',
    email: 'rafiq@dhakatesla.test',
    phone: '+8801711000003',
  });
}

/** Deliberately short on wallet funds, as in the seed data. */
export function createShirin(app: Express): Promise<Actor> {
  return createPassenger(app, {
    name: 'Shirin Akter',
    email: 'shirin@dhakatesla.test',
    phone: '+8801711000004',
    walletPaisa: 4_500n,
  });
}
