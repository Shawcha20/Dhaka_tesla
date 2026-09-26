'use client';

import { useState } from 'react';

import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui';
import { useAreas } from '@/hooks/use-areas';
import { useCreateRide, useQuote } from '@/hooks/use-rides';
import { ApiError } from '@/lib/api';
import { formatKm, formatTaka } from '@/lib/format';
import type { PaymentMethod, SessionUser } from '@/lib/types';

export function RideRequestForm({
  user,
  onCreated,
}: {
  user: SessionUser;
  onCreated: (rideId: number) => void;
}) {
  const areas = useAreas();
  const createRide = useCreateRide();

  const [pickupAreaId, setPickupAreaId] = useState<number | null>(null);
  const [dropoffAreaId, setDropoffAreaId] = useState<number | null>(null);
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');

  const quote = useQuote({ pickupAreaId, dropoffAreaId, seats });
  const error = createRide.error instanceof ApiError ? createRide.error : null;

  const sameArea =
    pickupAreaId !== null && dropoffAreaId !== null && pickupAreaId === dropoffAreaId;
  const complete = pickupAreaId !== null && dropoffAreaId !== null && !sameArea;

  /**
   * Whether a TeslaPay fare could actually settle.
   *
   * Checked against the *solo* price, which is the worst case: the discount only
   * exists if someone else happens to be going the same way, and promising a fare
   * the wallet cannot cover would be a surprise at the end of the trip.
   */
  const walletShortfall =
    paymentMethod === 'TESLAPAY' &&
    user.walletBalancePaisa !== null &&
    quote.data !== undefined &&
    user.walletBalancePaisa < quote.data.soloFarePaisa;

  if (areas.isLoading) {
    return (
      <Card className="grid place-items-center py-12">
        <Spinner className="size-5 text-neutral-400" />
        <span className="sr-only">Loading areas…</span>
      </Card>
    );
  }

  if (areas.error) {
    return (
      <Alert tone="error" title="Could not load the area list">
        Without it there is nowhere to travel from or to. Try reloading.
      </Alert>
    );
  }

  return (
    <Card as="section" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">Request a ride</h2>
        <p className="mt-0.5 text-sm text-neutral-600">
          Pick where you are and where you are going. If someone is heading the same way,
          you will share and both pay less.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete) return;
          createRide.mutate(
            { pickupAreaId: pickupAreaId!, dropoffAreaId: dropoffAreaId!, seats, paymentMethod },
            { onSuccess: (ride) => onCreated(ride.id) },
          );
        }}
      >
        {error && (
          <Alert tone="error">
            {error.code === 'PASSENGER_HAS_ACTIVE_RIDE'
              ? 'You already have a ride in progress. Finish or cancel it first.'
              : error.message}
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pickup" htmlFor="pickup">
            <Select
              id="pickup"
              value={pickupAreaId ?? ''}
              onChange={(e) => setPickupAreaId(e.target.value ? Number(e.target.value) : null)}
              required
            >
              <option value="">Where are you?</option>
              {areas.data?.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Destination"
            htmlFor="dropoff"
            error={sameArea ? 'Pick somewhere different from your pickup.' : undefined}
          >
            <Select
              id="dropoff"
              value={dropoffAreaId ?? ''}
              invalid={sameArea}
              onChange={(e) => setDropoffAreaId(e.target.value ? Number(e.target.value) : null)}
              required
            >
              <option value="">Where to?</option>
              {areas.data?.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Seats" htmlFor="seats">
            <Select id="seats" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'seat' : 'seats'}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Payment"
            htmlFor="payment"
            hint={
              user.walletBalancePaisa !== null
                ? `TeslaPay balance ${formatTaka(user.walletBalancePaisa)}`
                : undefined
            }
          >
            <Select
              id="payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            >
              <option value="CASH">Cash</option>
              <option value="TESLAPAY">TeslaPay wallet</option>
            </Select>
          </Field>
        </div>

        {complete && <FareQuote quote={quote} seats={seats} />}

        {walletShortfall && (
          <Alert tone="warning" title="Your wallet may not cover this">
            Riding alone costs {formatTaka(quote.data!.soloFarePaisa)}. If nobody shares the
            trip, the TeslaPay payment will fail and you will need to pay cash instead.
          </Alert>
        )}

        <Button type="submit" full loading={createRide.isPending} disabled={!complete}>
          {createRide.isPending ? 'Requesting…' : 'Request ride'}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Both prices, side by side.
 *
 * Showing only one would be a lie either way: quote the solo fare and sharing looks
 * like a surprise discount, quote the pooled fare and a passenger who ends up riding
 * alone feels overcharged. The honest thing is to say what it costs in both cases and
 * which one is not yet decided.
 */
function FareQuote({
  quote,
  seats,
}: {
  quote: ReturnType<typeof useQuote>;
  seats: number;
}) {
  if (quote.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-3 text-sm text-neutral-600">
        <Spinner className="size-4" />
        Working out the fare…
      </div>
    );
  }

  if (quote.error) {
    const error = quote.error instanceof ApiError ? quote.error : null;
    return <Alert tone="error">{error?.message ?? 'Could not price this trip.'}</Alert>;
  }

  if (!quote.data) return null;

  const { distanceKm, soloFarePaisa, estimatedPooledFarePaisa, breakdown } = quote.data;
  const saving = soloFarePaisa - estimatedPooledFarePaisa;

  return (
    <div className="bg-brand-50 ring-brand-200 space-y-3 rounded-lg p-3.5 ring-1 ring-inset">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-brand-700 text-xs font-semibold tracking-wide uppercase">
            Riding alone
          </p>
          <p className="tabular text-xl font-bold text-neutral-900">
            {formatTaka(soloFarePaisa)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-brand-700 text-xs font-semibold tracking-wide uppercase">
            If shared
          </p>
          <p className="tabular text-brand-700 text-xl font-bold">
            {formatTaka(estimatedPooledFarePaisa)}
          </p>
        </div>
      </div>

      <p className="text-brand-700 text-sm">
        Share and save {formatTaka(saving)} over {formatKm(distanceKm)}.
      </p>

      {/* The arithmetic is shown rather than hidden: a fare a passenger cannot check
          is a fare they have to take on trust. */}
      <details className="text-sm">
        <summary className="text-brand-700 cursor-pointer font-medium">
          How is this worked out?
        </summary>
        <dl className="tabular mt-2 space-y-1 text-neutral-700">
          <div className="flex justify-between">
            <dt>Base fare</dt>
            <dd>{formatTaka(breakdown.baseFarePaisa)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Distance ({formatKm(distanceKm)})</dt>
            <dd>{formatTaka(breakdown.distanceChargePaisa)}</dd>
          </div>
          <div className="flex justify-between text-neutral-500">
            <dt>Shared discount, on distance only</dt>
            <dd>−{formatTaka(soloFarePaisa - estimatedPooledFarePaisa)}</dd>
          </div>
          {seats > 1 && (
            <div className="flex justify-between border-t border-neutral-300 pt-1">
              <dt>× {seats} seats</dt>
              <dd>{formatTaka(estimatedPooledFarePaisa)}</dd>
            </div>
          )}
        </dl>
        <p className="mt-2 text-xs text-neutral-500">
          The base fare covers the driver coming to you, so it is never discounted — only
          the distance you share is.
        </p>
      </details>
    </div>
  );
}
