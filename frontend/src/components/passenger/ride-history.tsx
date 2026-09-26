'use client';

import Link from 'next/link';

import { Alert, Badge, Card, EmptyState, SkeletonRows } from '@/components/ui';
import { useMyRides, isLiveRide } from '@/hooks/use-rides';
import { formatDateTime, formatKm, formatTaka, rideStatusLabel, rideStatusTone } from '@/lib/format';

export function RideHistory() {
  const rides = useMyRides();

  if (rides.isLoading) return <SkeletonRows rows={2} />;

  if (rides.error) {
    return (
      <Alert tone="error" title="Could not load your rides">
        Try reloading the page.
      </Alert>
    );
  }

  // Past rides only: whatever is still live is already shown in full above, and
  // repeating it would make the page look like the passenger has two rides.
  const past = (rides.data?.data ?? []).filter((ride) => !isLiveRide(ride.status));

  if (past.length === 0) {
    return (
      <EmptyState title="No past rides yet">
        Rides you finish or cancel will be listed here.
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-2.5">
      {past.map((ride) => (
        <Card as="li" key={ride.id} className="hover:ring-neutral-300">
          <Link href={`/passenger/rides/${ride.id}`} className="block">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">
                  {ride.pickupArea.name} → {ride.dropoffArea.name}
                </p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {formatDateTime(ride.requestedAt)} · {formatKm(ride.distanceKm)}
                  {ride.pooled && ' · shared'}
                </p>
              </div>

              <div className="text-right">
                <Badge className={rideStatusTone(ride.status)}>
                  {rideStatusLabel(ride.status)}
                </Badge>
                {/* Only a completed ride has a fare worth showing — a cancelled one
                    was never charged, and printing a number beside it would imply
                    otherwise. */}
                {ride.finalFarePaisa !== null && (
                  <p className="tabular mt-1 text-sm font-semibold text-neutral-800">
                    {formatTaka(ride.finalFarePaisa)}
                  </p>
                )}
              </div>
            </div>
          </Link>
        </Card>
      ))}
    </ul>
  );
}
