'use client';

import { Alert, Badge, Card, EmptyState, SkeletonRows } from '@/components/ui';
import { isActivePool, useTripHistory } from '@/hooks/use-driver';
import { formatDateTime, formatTaka } from '@/lib/format';

export function TripHistory() {
  const history = useTripHistory();

  if (history.isLoading) return <SkeletonRows rows={2} />;

  if (history.error) {
    return (
      <Alert tone="error" title="Could not load your trips">
        Try reloading the page.
      </Alert>
    );
  }

  // The live trip is already shown in full above; repeating it here would look like
  // the driver has two.
  const past = (history.data?.data ?? []).filter((trip) => !isActivePool(trip.status));

  if (past.length === 0) {
    return (
      <EmptyState title="No completed trips yet">
        Finished and cancelled trips appear here with what you earned.
      </EmptyState>
    );
  }

  const earned = past.reduce((sum, trip) => sum + trip.earnedPaisa, 0);
  const shared = past.filter((trip) => trip.pooled).length;

  return (
    <div className="space-y-3">
      {/* A driver's actual question is "did pooling pay off", so the totals lead. */}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Earned so far
          </p>
          <p className="tabular text-xl font-bold text-neutral-900">{formatTaka(earned)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Shared trips
          </p>
          <p className="tabular text-xl font-bold text-neutral-900">
            {shared} of {past.length}
          </p>
        </div>
      </Card>

      <ul className="space-y-2.5">
        {past.map((trip) => (
          <Card as="li" key={trip.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">
                  From {trip.pickupArea.name}
                  {trip.pooled && (
                    <span className="text-brand-700 ml-2 text-sm font-normal">shared</span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {formatDateTime(trip.createdAt)} · {trip.seatsUsed}/{trip.capacity} seats (
                  {trip.utilisationPct}%)
                </p>
                {trip.passengers.length > 0 && (
                  <p className="mt-1 text-sm text-neutral-600">
                    {trip.passengers
                      .map((passenger) => `${passenger.name} → ${passenger.dropoffArea}`)
                      .join(' · ')}
                  </p>
                )}
              </div>

              <div className="text-right">
                <Badge
                  className={
                    trip.status === 'COMPLETED'
                      ? 'bg-neutral-100 text-neutral-700 ring-neutral-200'
                      : 'bg-rose-100 text-rose-900 ring-rose-200'
                  }
                >
                  {trip.status === 'COMPLETED' ? 'completed' : 'cancelled'}
                </Badge>
                {/* A cancelled trip earned nothing, so no figure is shown rather than
                    a misleading zero next to a fare-shaped slot. */}
                {trip.status === 'COMPLETED' && (
                  <p className="tabular mt-1 font-semibold text-neutral-900">
                    {formatTaka(trip.earnedPaisa)}
                  </p>
                )}
              </div>
            </div>

            {trip.passengers.some((passenger) => passenger.paymentStatus === 'FAILED') && (
              <p className="mt-2 text-sm text-rose-700">
                Unpaid:{' '}
                {trip.passengers
                  .filter((passenger) => passenger.paymentStatus === 'FAILED')
                  .map((passenger) => passenger.name)
                  .join(', ')}
              </p>
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}
