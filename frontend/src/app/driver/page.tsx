'use client';

import { AppShell } from '@/components/app-shell';
import { ActiveTrip } from '@/components/driver/active-trip';
import { RequestBoard } from '@/components/driver/request-board';
import { TripHistory } from '@/components/driver/trip-history';
import {
  Alert,
  Card,
  Reveal,
  SectionHeading,
  SkeletonRows,
  Switch,
} from '@/components/ui';
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
          <Reveal as="section">
            <ActiveTrip pool={pool} />
          </Reveal>
        ) : null}

        <Reveal as="section" delay={60}>
          <SectionHeading live={isOnline}>
            {pool ? 'Add another passenger' : 'Waiting for a ride'}
          </SectionHeading>
          <RequestBoard isOnline={isOnline} />
        </Reveal>

        <Reveal as="section" delay={120}>
          <SectionHeading>Your trips</SectionHeading>
          <TripHistory />
        </Reveal>
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
    <Card
      className={
        // The card itself carries the state, so a driver can tell at a glance without
        // reading the switch. Colour is the fastest channel there is.
        isOnline
          ? 'from-brand-50 ring-brand-200 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r to-white py-3 transition-colors duration-300'
          : 'flex flex-wrap items-center justify-between gap-3 py-3 transition-colors duration-300'
      }
    >
      <div>
        <p className="text-sm font-medium text-neutral-900">
          {isOnline ? 'You are online' : 'You are offline'}
        </p>
        <p className="text-sm text-neutral-500">
          {isOnline
            ? 'Passengers waiting nearby are shown below.'
            : 'Go online to start accepting rides.'}
        </p>
        {/* Explains the disabled switch rather than leaving the driver to guess.
            Going offline mid-trip would leave passengers with an unresolvable ride. */}
        {isOnline && hasActiveTrip && (
          <p className="mt-0.5 text-xs text-amber-800">
            Finish or cancel your trip before going offline.
          </p>
        )}
      </div>

      <Switch
        checked={isOnline}
        pending={status.isPending}
        disabled={isOnline && hasActiveTrip}
        label={isOnline ? 'Go offline' : 'Go online'}
        onChange={(next) => status.mutate(next)}
      />

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
