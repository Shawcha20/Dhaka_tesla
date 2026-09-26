'use client';

import { useState } from 'react';

import { SeatMeter } from '@/components/driver/seat-meter';
import { Alert, Badge, Button, Card, Field, LiveDot, Reveal, TextInput } from '@/components/ui';
import { useCancelPool, useTripAction } from '@/hooks/use-driver';
import { ApiError } from '@/lib/api';
import { formatKm, formatTaka, formatTime, poolStatusLabel } from '@/lib/format';
import type { PoolDetail, SettlementLine } from '@/lib/types';

/** What the driver does next, given where the trip is. */
const NEXT_ACTION = {
  FORMING: { action: 'arrive', label: "I've arrived at pickup" },
  DRIVER_ARRIVED: { action: 'start', label: 'Start the trip' },
  STARTED: { action: 'complete', label: 'Complete the trip' },
} as const;

export function ActiveTrip({ pool }: { pool: PoolDetail }) {
  const tripAction = useTripAction();
  const cancelPool = useCancelPool();

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<SettlementLine[] | null>(null);

  const next = NEXT_ACTION[pool.status as keyof typeof NEXT_ACTION] ?? null;
  const actionError = tripAction.error instanceof ApiError ? tripAction.error : null;
  const cancelError = cancelPool.error instanceof ApiError ? cancelPool.error : null;

  const active = pool.members.filter((member) => member.active);
  const departed = pool.members.filter((member) => !member.active);

  return (
    <div className="space-y-4">
      <Card as="section" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-neutral-900">
              Picking up from {pool.pickupArea.name}
            </p>
            <p className="mt-0.5 text-sm text-neutral-500">
              {pool.vehicle.name} · {pool.vehicle.plateNo}
            </p>
          </div>
          <Badge
            className={
              pool.status === 'STARTED'
                ? 'bg-brand-100 text-brand-700 ring-brand-200'
                : 'bg-sky-100 text-sky-900 ring-sky-200'
            }
          >
            {pool.status === 'STARTED' && <LiveDot />}
            {poolStatusLabel(pool.status)}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3">
          <SeatMeter seatsTaken={pool.seatsTaken} capacity={pool.capacity} />
          <div className="text-right">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              This trip
            </p>
            {/* Keyed on the total so it pops when a passenger joins — the figure a
                driver is deciding on, and the one that moves without them acting. */}
            <p
              key={pool.totalFarePaisa}
              className="tabular animate-pop text-xl font-bold text-neutral-900"
            >
              {formatTaka(pool.totalFarePaisa)}
            </p>
          </div>
        </div>

        {pool.status === 'FORMING' && pool.freeSeats > 0 && (
          <Alert tone="info">
            You can still add {pool.freeSeats === 1 ? 'one more passenger' : 'more passengers'}{' '}
            going the same way. Once you mark yourself as arrived, the trip closes to new
            passengers.
          </Alert>
        )}
      </Card>

      <Card as="section" className="space-y-3">
        <h2 className="text-base font-semibold text-neutral-900">
          Passengers ({active.length})
        </h2>

        <ul className="divide-y divide-neutral-200">
          {active.map((member, index) => (
            <li
              key={member.rideRequestId}
              className="animate-rise flex items-start justify-between gap-3 py-2.5"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">{member.passenger.name}</p>
                <p className="mt-0.5 text-sm text-neutral-600">
                  to {member.dropoffArea.name} · {formatKm(member.distanceKm)} ·{' '}
                  {member.seats} {member.seats === 1 ? 'seat' : 'seats'}
                </p>
                {member.passenger.phone && (
                  <a
                    href={`tel:${member.passenger.phone}`}
                    className="text-brand-700 mt-0.5 inline-block text-sm font-medium hover:underline"
                  >
                    Call
                  </a>
                )}
              </div>
              <div className="shrink-0 text-right">
                {/* The driver sees fares because the driver collects the money. */}
                <p className="tabular font-semibold text-neutral-900">
                  {formatTaka(member.finalFarePaisa ?? member.farePaisa)}
                </p>
                <p className="text-xs text-neutral-500">
                  {member.paymentMethod === 'CASH' ? 'cash' : 'TeslaPay'}
                  {member.finalFarePaisa !== null && ' · fixed'}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {departed.length > 0 && (
          <div className="border-t border-neutral-200 pt-2.5">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Left before departure
            </p>
            <ul className="mt-1.5 space-y-1 text-sm text-neutral-500">
              {departed.map((member) => (
                <li key={member.rideRequestId}>
                  {member.passenger.name} — to {member.dropoffArea.name}
                  {member.leftAt && `, cancelled ${formatTime(member.leftAt)}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {settlement && (
        <Reveal animation="pop">
          <SettlementSummary lines={settlement} />
        </Reveal>
      )}

      <Card as="section" className="space-y-3">
        {actionError && (
          <Alert tone="error">
            {actionError.code === 'POOL_EMPTY'
              ? 'Everyone cancelled before departure, so there is nobody to drive. Cancel the trip instead.'
              : actionError.message}
          </Alert>
        )}

        {next && (
          <>
            <Button
              full
              loading={tripAction.isPending}
              onClick={() =>
                tripAction.mutate(
                  { poolId: pool.id, action: next.action },
                  {
                    onSuccess: ({ meta }) => {
                      if (meta.settlement.length > 0) setSettlement(meta.settlement);
                    },
                  },
                )
              }
            >
              {next.label}
            </Button>
            {next.action === 'start' && (
              <p className="text-center text-xs text-neutral-500">
                Starting fixes every fare. After this, passengers joining or leaving no longer
                changes what anyone pays.
              </p>
            )}
          </>
        )}

        {pool.status !== 'STARTED' && (
          <div className="border-t border-neutral-200 pt-3">
            {cancelError && <Alert tone="error">{cancelError.message}</Alert>}

            {confirmingCancel ? (
              <div className="space-y-3">
                <Field
                  label="What happened?"
                  htmlFor="cancel-reason"
                  hint="Your passengers will be put back in the queue for another driver."
                >
                  <TextInput
                    id="cancel-reason"
                    value={reason}
                    maxLength={255}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Battery died"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    loading={cancelPool.isPending}
                    onClick={() =>
                      cancelPool.mutate({
                        poolId: pool.id,
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      })
                    }
                  >
                    Cancel trip
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
                    Keep going
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" full onClick={() => setConfirmingCancel(true)}>
                Cancel this trip
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * What actually settled when the trip completed.
 *
 * A failed TeslaPay payment does not block completion — the passenger has already
 * been delivered — so the driver needs to be told plainly who still owes them cash.
 * Silently marking it FAILED in the database would leave them out of pocket.
 */
function SettlementSummary({ lines }: { lines: SettlementLine[] }) {
  const failed = lines.filter((line) => line.status === 'FAILED');
  const total = lines
    .filter((line) => line.status === 'PAID')
    .reduce((sum, line) => sum + line.amountPaisa, 0);

  return (
    <Card as="section" className="space-y-3">
      <h2 className="text-base font-semibold text-neutral-900">Trip complete</h2>

      <ul className="divide-y divide-neutral-200">
        {lines.map((line) => (
          <li key={line.rideRequestId} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium text-neutral-900">{line.passengerName}</p>
              <p className="text-xs text-neutral-500">
                {line.method === 'CASH' ? 'cash' : 'TeslaPay'}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular font-semibold text-neutral-900">
                {formatTaka(line.amountPaisa)}
              </p>
              <Badge
                className={
                  line.status === 'PAID'
                    ? 'bg-brand-50 text-brand-700 ring-brand-200'
                    : 'bg-rose-50 text-rose-900 ring-rose-200'
                }
              >
                {line.status === 'PAID' ? 'paid' : 'not paid'}
              </Badge>
            </div>
          </li>
        ))}
      </ul>

      <div className="tabular flex justify-between border-t border-neutral-200 pt-2 font-semibold">
        <span>Collected</span>
        <span>{formatTaka(total)}</span>
      </div>

      {failed.length > 0 && (
        <Alert tone="warning" title="Collect these in cash">
          {failed.map((line) => line.passengerName).join(', ')} did not have enough TeslaPay
          balance. The trip is finished, but the fare is still owed.
        </Alert>
      )}
    </Card>
  );
}
