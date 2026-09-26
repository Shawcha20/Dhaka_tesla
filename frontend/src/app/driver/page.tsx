'use client';

import { AppShell } from '@/components/app-shell';
import { ActiveTrip } from '@/components/driver/active-trip';
import { RequestBoard } from '@/components/driver/request-board';
import { TripHistory } from '@/components/driver/trip-history';
import { Alert, Button, Card, SkeletonRows } from '@/components/ui';
import { isActivePool, useCurrentPool, useVehicleStatus } from '@/hooks/use-driver';
import { useSession } from '@/hooks/use-session';
import { ApiError } from '@/lib/api';

/**
 * The driver's working screen.
 *
 * Three concerns, in the order they matter while driving: the trip in progress, who
 * is waiting, and what has been earned. A driver glancing at a phone at a junction
 * should find the next action at the top without scrolling.
 */
export default function DriverPage() {
  const { user } = useSession();
  const currentPool = useCurrentPool();

  const pool = currentPool.data && isActivePool(currentPool.data.status) ? currentPool.data : null;
  const isOnline = user?.vehicle?.isOnline ?? false;

  return (
    <AppShell
      role="DRIVER"
      title={pool ? 'Trip in progress' : isOnline ? 'Looking for passengers' : 'Offline'}
      actions={<OnlineToggle isOnline={isOnline} hasActiveTrip={pool !== null} />}
    >
      <div className="space-y-8">
        {currentPool.isLoading ? (
          <SkeletonRows rows={2} />
        ) : currentPool.error ? (
          <Alert tone="error" title="Could not load your current trip">
            Reload the page to try again.
          </Alert>
        ) : pool ? (
          <section>
            <ActiveTrip pool={pool} />
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase">
            {pool ? 'Add another passenger' : 'Waiting for a ride'}
          </h2>
          <RequestBoard isOnline={isOnline} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase">
            Your trips
          </h2>
          <TripHistory />
        </section>
      </div>
    </AppShell>
  );
}

function OnlineToggle({
  isOnline,
  hasActiveTrip,
}: {
  isOnline: boolean;
  hasActiveTrip: boolean;
}) {
  const status = useVehicleStatus();
  const error = status.error instanceof ApiError ? status.error : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium text-neutral-900">
          {isOnline ? 'You are online' : 'You are offline'}
        </p>
        <p className="text-sm text-neutral-500">
          {isOnline
            ? 'Passengers waiting nearby are shown below.'
            : 'Go online to start accepting rides.'}
        </p>
        {/* Explains the disabled button rather than leaving the driver to guess.
            Going offline mid-trip would leave passengers with an unresolvable ride. */}
        {isOnline && hasActiveTrip && (
          <p className="mt-0.5 text-xs text-amber-800">
            Finish or cancel your trip before going offline.
          </p>
        )}
      </div>

      <Button
        variant={isOnline ? 'secondary' : 'primary'}
        loading={status.isPending}
        disabled={isOnline && hasActiveTrip}
        onClick={() => status.mutate(!isOnline)}
      >
        {isOnline ? 'Go offline' : 'Go online'}
      </Button>

      {error && (
        <div className="w-full">
          <Alert tone="error">
            {error.code === 'POOL_IN_PROGRESS'
              ? 'You cannot go offline while carrying passengers.'
              : error.message}
          </Alert>
        </div>
      )}
    </Card>
  );
}
