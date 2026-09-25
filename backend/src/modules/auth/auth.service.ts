import { randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { Role } from '../../domain/auth.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from '../../lib/tokens.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';

export interface UserDto {
  id: bigint;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
}

export interface AuthResult {
  user: UserDto;
  accessToken: string;
  refreshToken: string;
}

const USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
} as const;

/**
 * A valid argon2 hash of a random string, used to make a lookup miss cost the
 * same as a lookup hit.
 *
 * Without it, "no such email" returns in under a millisecond while "wrong
 * password" takes ~18ms, and that difference is a reliable account-enumeration
 * oracle. Computed once, lazily, because argon2 is deliberately slow.
 */
let timingDecoyHash: string | undefined;
async function getTimingDecoyHash(): Promise<string> {
  timingDecoyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  return timingDecoyHash;
}

/** Issues a fresh access token and a newly persisted refresh token. */
async function issueTokens(
  user: UserDto,
  userAgent: string | undefined,
): Promise<AuthResult> {
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      ...(userAgent ? { userAgent: userAgent.slice(0, 255) } : {}),
    },
  });

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
  };
}

/**
 * Self-signup creates a PASSENGER only.
 *
 * Drivers are seeded, because onboarding one means verifying a licence and
 * registering a vehicle — a process with no meaningful MVP version. Documented as
 * an assumption rather than left as a gap.
 */
export async function register(
  input: RegisterInput,
  userAgent: string | undefined,
): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          ...(input.phone ? { phone: input.phone } : {}),
          passwordHash,
          role: 'PASSENGER',
        },
        select: USER_FIELDS,
      });

      // An empty wallet, created up front so the TeslaPay path never has to
      // decide whether a wallet exists. Balance zero needs no ledger entry:
      // the sum of no entries is zero, so the two still agree.
      await tx.wallet.create({ data: { userId: created.id, balancePaisa: 0n } });

      return created;
    });

    return await issueTokens(user, userAgent);
  } catch (e) {
    /**
     * Relies on the unique index rather than a pre-flight SELECT.
     *
     * Checking first and then inserting is a race: two simultaneous signups with
     * the same email both see "available" and both proceed. Letting the database
     * arbitrate is the same reasoning applied to seat claims.
     */
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String(e.meta?.['target'] ?? '');
      if (target.includes('phone')) {
        throw new AppError('EMAIL_ALREADY_REGISTERED', {
          message: 'That phone number is already registered.',
          cause: e,
        });
      }
      throw new AppError('EMAIL_ALREADY_REGISTERED', { cause: e });
    }
    throw e;
  }
}

export async function login(
  input: LoginInput,
  userAgent: string | undefined,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...USER_FIELDS, passwordHash: true, isActive: true },
  });

  // Always perform a verification, even with no user, so both paths cost the same.
  const hash = user?.passwordHash ?? (await getTimingDecoyHash());
  const passwordMatches = await verifyPassword(hash, input.password);

  if (!user || !passwordMatches) {
    // One message for both causes: revealing which half was wrong turns this
    // endpoint into an account-existence check.
    throw new AppError('INVALID_CREDENTIALS');
  }
  if (!user.isActive) {
    throw new AppError('ACCOUNT_DISABLED');
  }

  const { passwordHash: _passwordHash, isActive: _isActive, ...dto } = user;
  return issueTokens(dto, userAgent);
}

/**
 * Rotates the refresh token: the presented one is revoked and a new one issued.
 *
 * Rotation means a stolen token is usable at most once. It also makes theft
 * detectable — if an already-revoked token is presented, either the legitimate
 * client or an attacker is replaying, and we cannot tell which. The safe response
 * is to revoke every session for that user and make them sign in again.
 */
export async function refresh(
  rawToken: string | undefined,
  userAgent: string | undefined,
): Promise<AuthResult> {
  if (!rawToken) {
    throw new AppError('UNAUTHENTICATED', { message: 'No refresh token provided.' });
  }

  const tokenHash = hashRefreshToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { ...USER_FIELDS, isActive: true } } },
  });

  if (!stored) {
    throw new AppError('UNAUTHENTICATED', { message: 'Unrecognised refresh token.' });
  }

  if (stored.revokedAt) {
    await revokeAllSessions(stored.userId);
    throw new AppError('TOKEN_REUSE_DETECTED', {
      context: { userId: stored.userId.toString(), tokenId: stored.id.toString() },
    });
  }

  if (stored.expiresAt <= new Date()) {
    throw new AppError('TOKEN_EXPIRED', { message: 'Session has expired.' });
  }

  if (!stored.user.isActive) {
    throw new AppError('ACCOUNT_DISABLED');
  }

  const { isActive: _isActive, ...dto } = stored.user;

  // Revoke and re-issue atomically: a crash between the two must not leave the
  // user holding a token that has been revoked but never replaced.
  const rotated = generateRefreshToken();
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: rotated.tokenHash,
        expiresAt: rotated.expiresAt,
        ...(userAgent ? { userAgent: userAgent.slice(0, 255) } : {}),
      },
    }),
  ]);

  return { user: dto, accessToken: signAccessToken(dto), refreshToken: rotated.token };
}

/**
 * Revokes the presented token. Idempotent and silent about unknown tokens —
 * logout should never fail, and it must not report whether a token was real.
 */
export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Used on reuse detection, and by a future password change. */
export async function revokeAllSessions(userId: bigint): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

export interface MeDto extends UserDto {
  vehicle: {
    id: bigint;
    name: string;
    plateNo: string;
    capacity: number;
    isOnline: boolean;
  } | null;
  walletBalancePaisa: bigint | null;
}

export async function getMe(userId: bigint): Promise<MeDto> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...USER_FIELDS,
      vehicle: {
        select: { id: true, name: true, plateNo: true, capacity: true, isOnline: true },
      },
      wallet: { select: { balancePaisa: true } },
    },
  });

  if (!user) {
    throw new AppError('UNAUTHENTICATED', { message: 'Account no longer exists.' });
  }

  const { vehicle, wallet, ...dto } = user;
  return {
    ...dto,
    vehicle: vehicle ?? null,
    walletBalancePaisa: wallet?.balancePaisa ?? null,
  };
}
