'use client';

import { useState } from 'react';

import { StatusTimeline } from '@/components/status-timeline';
import { Alert, Badge, Button, Card, Field, Spinner, TextInput } from '@/components/ui';
import { useCancelRide, useRide } from '@/hooks/use-rides';
import { ApiError } from '@/lib/api';
import { formatKm, formatTaka, rideStatusLabel, rideStatusTone } from '@/lib/format';
import type { RideDetail } from '@/lib/types';

/** Cancelling is allowed right up to departure, and not after. */
const CANCELLABLE = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED'];

export function ActiveRide({ rideId }: { rideId: number }) {
  const ride = useRide(rideId);

  if (ride.isLoading) {
    return (
      <Card className="grid place-items-center py-16">
        <Spinner className="size-5 text-neutral-400" />
        <span className="sr-only">Loading your ride…</span>
      </Card>
    );
  }

  if (ride.error) {
    const error = ride.error instanceof ApiError ? ride.error : null;
    return (
      <Alert tone="error" title="Could not load this ride">
        {error?.message ?? 'Something went wrong.'}
      </Alert>
    );
  }

  if (!ride.data) return null;

  return <RideView ride={ride.data} />;
}

function RideView({ ride }: { ride: RideDetail }) {
  const cancel = useCancelRide();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  const cancelError = cancel.error instanceof ApiError ? cancel.error : null;
  const canCancel = CANCELLABLE.includes(ride.status);
  const pooled = ride.pool !== null && ride.pool.companions.length > 0;

  return (
    <div className="space-y-4">
      <Card as="section" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-neutral-900">
              {ride.pickupArea.name} → {ride.dropoffArea.name}
            </p>
            <p className="mt-0.5 text-sm text-neutral-500">
              {formatKm(ride.distanceKm)} · {ride.seats} {ride.seats === 1 ? 'seat' : 'seats'} ·{' '}
              {ride.paymentMethod === 'CASH' ? 'cash' : 'TeslaPay'}
            </p>
          </div>
          <Badge className={rideStatusTone(ride.status)}>{rideStatusLabel(ride.status)}</Badge>
        </div>

        <FareLine ride={ride} pooled={pooled} />

        <StatusTimeline status={ride.status} entries={ride.timeline} />
      </Card>

      {ride.pool && <PoolCard ride={ride} />}

      {canCancel && (
        <Card as="section" className="space-y-3">
          {cancelError && (
            <Alert tone="error">
              {cancelError.code === 'RIDE_NOT_CANCELLABLE'
                ? 'Too late to cancel — the trip has already started.'
                : cancelError.message}
            </Alert>
          )}

          {confirming ? (
            <>
              <Field
                label="Why are you cancelling?"
                htmlFor="reason"
                hint="Optional, but it helps us understand what went wrong."
              >
                <TextInput
                  id="reason"
                  value={reason}
                  maxLength={255}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Found a CNG"
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={cancel.isPending}
                  onClick={() =>
                    cancel.mutate({ rideId: ride.id, ...(reason.trim() ? { reason: reason.trim() } : {}) })
                  }
                >
                  Cancel this ride
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-neutral-600">
                {ride.status === 'DRIVER_ARRIVED'
                  ? 'Your driver is waiting. You can still cancel, but only until the trip starts.'
                  : 'You can cancel until the trip starts.'}
              </p>
              {/* Two steps on purpose: a mis-tap should not cancel a ride whose driver
                  is already at the kerb. */}
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Cancel ride
              </Button>
            </div>
          )}
        </Card>
      )}

      {ride.status === 'STARTED' && (
        <Alert tone="info">
          You are on your way. The fare is now fixed at{' '}
          <strong className="tabular">{formatTaka(ride.currentFarePaisa)}</strong> and will not
          change.
        </Alert>
      )}
    </div>
  );
}

/**
 * What this passenger owes, and why it differs from the quote.
 *
 * The drop from estimate to current fare is the whole point of the product, so it is
 * stated explicitly rather than left for the passenger to notice.
 */
function FareLine({ ride, pooled }: { ride: RideDetail; pooled: boolean }) {
  const discounted = ride.currentFarePaisa < ride.estimatedFarePaisa;
  const locked = ride.finalFarePaisa !== null;

  return (
    <div className="bg-brand-50 ring-brand-200 rounded-lg p-3.5 ring-1 ring-inset">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-brand-700 text-xs font-semibold tracking-wide uppercase">
            {locked ? 'Final fare' : 'Your fare'}
          </p>
          <p className="tabular text-2xl font-bold text-neutral-900">
            {formatTaka(ride.currentFarePaisa)}
          </p>
        </div>
        {discounted && (
          <div className="text-right">
            <p className="tabular text-sm text-neutral-500 line-through">
              {formatTaka(ride.estimatedFarePaisa)}
            </p>
            <p className="text-brand-700 text-sm font-medium">
              saved {formatTaka(ride.estimatedFarePaisa - ride.currentFarePaisa)}
            </p>
          </div>
        )}
      </div>

      <p className="text-brand-700 mt-1.5 text-sm">
        {locked
          ? 'Locked in when the trip started.'
          : pooled
            ? 'Shared, so the distance discount applies.'
            : 'Riding alone so far. If someone joins, this goes down.'}
      </p>
    </div>
  );
}

function PoolCard({ ride }: { ride: RideDetail }) {
  const pool = ride.pool!;

  return (
    <Card as="section" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-900">Your Tesla</h2>
        <Badge className="tabular">
          {pool.seatsTaken} of {pool.capacity} seats taken
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <div>
          <p className="font-medium text-neutral-800">
            {pool.vehicle.name} · {pool.vehicle.plateNo}
          </p>
          <p className="text-neutral-500">Driven by {pool.driver.name}</p>
        </div>
        {/* A phone link rather than plain text: the passenger may be standing at the
            wrong corner and needs to call, not copy digits. */}
        {pool.driver.phone && (
          <a
            href={`tel:${pool.driver.phone}`}
            className="text-brand-700 shrink-0 font-medium hover:underline"
          >
            Call driver
          </a>
        )}
      </div>

      {pool.companions.length > 0 ? (
        <div className="border-t border-neutral-200 pt-3">
          <p className="text-sm font-medium text-neutral-800">
            Sharing with {pool.companions.length === 1 ? 'one other person' : 'others'}
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-neutral-600">
            {pool.companions.map((companion, index) => (
              <li key={index}>
                {companion.name}, going to {companion.dropoffArea}
                {companion.seats > 1 && ` (${companion.seats} seats)`}
              </li>
            ))}
          </ul>
          {/* Said out loud, because the obvious next question is "what are they
              paying?" and the answer is that it is none of our business. */}
          <p className="mt-2 text-xs text-neutral-500">
            You can see where they are going, but not what they pay — and they cannot see
            your fare either.
          </p>
        </div>
      ) : (
        <p className="border-t border-neutral-200 pt-3 text-sm text-neutral-500">
          Nobody else yet. If someone heading the same way is added, your fare drops.
        </p>
      )}
    </Card>
  );
}
