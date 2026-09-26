'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { StatusTimeline } from '@/components/status-timeline';
import { Alert, Badge, Card, Spinner } from '@/components/ui';
import { useRide } from '@/hooks/use-rides';
import { ApiError } from '@/lib/api';
import {
  formatDateTime,
  formatKm,
  formatTaka,
  rideStatusLabel,
  rideStatusTone,
} from '@/lib/format';

/**
 * A single past ride, in full.
 *
 * This is the receipt: what was quoted, what was actually charged, who shared the
 * Tesla, and every status change with a timestamp and an actor. The brief asks that
 * the system be able to explain exactly what happened after the fact — this is that
 * explanation, shown to the person it concerns.
 */
export default function RideDetailPage() {
  const params = useParams<{ id: string }>();
  const parsed = Number(params.id);
  const rideId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  const ride = useRide(rideId);

  return (
    <AppShell role="PASSENGER" title="Ride details">
      <Link href="/passenger" className="text-brand-700 text-sm font-medium hover:underline">
        ← Back to your rides
      </Link>

      <div className="mt-4">
        {rideId === null ? (
          <Alert tone="error" title="Not a valid ride">
            That link does not point at a ride.
          </Alert>
        ) : ride.isLoading ? (
          <Card className="grid place-items-center py-16">
            <Spinner className="size-5 text-neutral-400" />
            <span className="sr-only">Loading…</span>
          </Card>
        ) : ride.error ? (
          <Alert tone="error" title="Ride not found">
            {/* The API answers 404 for someone else's ride as well as a missing one,
                so the wording covers both without hinting which it was. */}
            {ride.error instanceof ApiError && ride.error.status === 404
              ? 'This ride does not exist, or it is not yours.'
              : 'Something went wrong loading this ride.'}
          </Alert>
        ) : ride.data ? (
          <div className="space-y-4">
            <Card as="section" className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-neutral-900">
                    {ride.data.pickupArea.name} → {ride.data.dropoffArea.name}
                  </p>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {formatDateTime(ride.data.requestedAt)} · {formatKm(ride.data.distanceKm)} ·{' '}
                    {ride.data.seats} {ride.data.seats === 1 ? 'seat' : 'seats'}
                  </p>
                </div>
                <Badge className={rideStatusTone(ride.data.status)}>
                  {rideStatusLabel(ride.data.status)}
                </Badge>
              </div>

              <dl className="tabular grid gap-2 border-t border-neutral-200 pt-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between sm:block">
                  <dt className="text-neutral-500">Quoted alone</dt>
                  <dd className="font-medium text-neutral-800">
                    {formatTaka(ride.data.estimatedFarePaisa)}
                  </dd>
                </div>
                <div className="flex justify-between sm:block">
                  <dt className="text-neutral-500">
                    {ride.data.finalFarePaisa !== null ? 'Charged' : 'Not charged'}
                  </dt>
                  <dd className="font-medium text-neutral-800">
                    {ride.data.finalFarePaisa !== null
                      ? `${formatTaka(ride.data.finalFarePaisa)} by ${
                          ride.data.paymentMethod === 'CASH' ? 'cash' : 'TeslaPay'
                        }`
                      : '—'}
                  </dd>
                </div>
              </dl>

              {ride.data.cancelReason && (
                <p className="text-sm text-neutral-600">
                  Reason given: <span className="italic">{ride.data.cancelReason}</span>
                </p>
              )}
            </Card>

            {ride.data.pool && (
              <Card as="section" className="space-y-2">
                <h2 className="text-base font-semibold text-neutral-900">The Tesla</h2>
                <p className="text-sm text-neutral-600">
                  {ride.data.pool.vehicle.name} ({ride.data.pool.vehicle.plateNo}), driven by{' '}
                  {ride.data.pool.driver.name} — {ride.data.pool.seatsTaken} of{' '}
                  {ride.data.pool.capacity} seats used.
                </p>
                {ride.data.pool.companions.length > 0 && (
                  <ul className="mt-1 space-y-1 text-sm text-neutral-600">
                    {ride.data.pool.companions.map((companion, index) => (
                      <li key={index}>
                        Shared with {companion.name}, going to {companion.dropoffArea}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            <Card as="section">
              <h2 className="mb-4 text-base font-semibold text-neutral-900">What happened</h2>
              <StatusTimeline status={ride.data.status} entries={ride.data.timeline} />
            </Card>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
