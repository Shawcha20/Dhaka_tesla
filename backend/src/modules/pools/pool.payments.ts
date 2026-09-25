import type { PaymentMethod, PaymentStatus } from '@prisma/client';

import type { DbWriter } from '../../lib/history.js';

/**
 * Payment settlement for a completed trip.
 *
 * No gateway, as the brief allows: CASH is a record that the driver collected it,
 * TESLAPAY moves money between a simulated wallet and a ledger.
 */

export interface SettlementLine {
  rideRequestId: bigint;
  passengerName: string;
  method: PaymentMethod;
  amountPaisa: bigint;
  status: PaymentStatus;
  /** Present only when a debit could not be taken. */
  failureReason?: 'INSUFFICIENT_WALLET_BALANCE';
}

/**
 * Creates one PENDING payment per active member, at the moment the trip starts.
 *
 * Deliberately not at request time: the amount is not knowable until the fare
 * locks, and a payment row carrying a figure that could still change would be a
 * receipt for a price nobody agreed to.
 */
export async function createPendingPayments(db: DbWriter, poolId: bigint): Promise<void> {
  const members = await db.poolMember.findMany({
    where: { poolId, leftAt: null },
    select: {
      farePaisa: true,
      rideRequest: {
        select: { id: true, passengerId: true, paymentMethod: true },
      },
    },
  });

  if (members.length === 0) return;

  await db.payment.createMany({
    data: members.map((member) => ({
      rideRequestId: member.rideRequest.id,
      payerId: member.rideRequest.passengerId,
      // Copied, not referenced, so the receipt is self-contained.
      amountPaisa: member.farePaisa,
      method: member.rideRequest.paymentMethod,
      status: 'PENDING' as const,
    })),
  });
}

/**
 * Settles every pending payment on a pool.
 *
 * A wallet shortfall marks that one payment FAILED and the trip still completes.
 * The alternative — refusing to complete — would strand the driver over someone
 * else's balance, with passengers already delivered. A failed TeslaPay payment is
 * a debt to collect in cash, not a reason to hold the trip open.
 */
export async function settlePoolPayments(
  db: DbWriter,
  poolId: bigint,
): Promise<SettlementLine[]> {
  const payments = await db.payment.findMany({
    where: {
      status: 'PENDING',
      rideRequest: { poolMember: { poolId, leftAt: null } },
    },
    select: {
      id: true,
      amountPaisa: true,
      method: true,
      payerId: true,
      rideRequestId: true,
      payer: { select: { name: true } },
    },
  });

  const lines: SettlementLine[] = [];
  const now = new Date();

  for (const payment of payments) {
    if (payment.method === 'CASH') {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'PAID', paidAt: now },
      });
      lines.push({
        rideRequestId: payment.rideRequestId,
        passengerName: payment.payer.name,
        method: 'CASH',
        amountPaisa: payment.amountPaisa,
        status: 'PAID',
      });
      continue;
    }

    /**
     * Atomic conditional debit — the same shape as the seat claim.
     *
     * Reading the balance and then writing it would let two concurrent debits
     * both pass an affordability check and overdraw. Here the balance test lives
     * in the WHERE clause, so a debit either takes the money or matches nothing.
     * `balance_paisa` is also BIGINT UNSIGNED, so MySQL would reject the
     * subtraction even if this guard were missing.
     */
    const debited = await db.$executeRaw`
      UPDATE wallets
         SET balance_paisa = balance_paisa - ${payment.amountPaisa}
       WHERE user_id = ${payment.payerId}
         AND balance_paisa >= ${payment.amountPaisa}
    `;

    if (debited !== 1) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      lines.push({
        rideRequestId: payment.rideRequestId,
        passengerName: payment.payer.name,
        method: 'TESLAPAY',
        amountPaisa: payment.amountPaisa,
        status: 'FAILED',
        failureReason: 'INSUFFICIENT_WALLET_BALANCE',
      });
      continue;
    }

    // Read back inside the transaction so the ledger's running balance is the
    // one that actually applied.
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { userId: payment.payerId },
      select: { id: true, balancePaisa: true },
    });

    await db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        direction: 'DEBIT',
        amountPaisa: payment.amountPaisa,
        // Recorded per row so any disagreement between ledger and balance is
        // detectable rather than a mystery.
        balanceAfterPaisa: wallet.balancePaisa,
        rideRequestId: payment.rideRequestId,
        note: 'TeslaPay fare',
      },
    });

    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: now },
    });

    lines.push({
      rideRequestId: payment.rideRequestId,
      passengerName: payment.payer.name,
      method: 'TESLAPAY',
      amountPaisa: payment.amountPaisa,
      status: 'PAID',
    });
  }

  return lines;
}
