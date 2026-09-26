'use client';

import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { ActiveRide } from '@/components/passenger/active-ride';
import { RideHistory } from '@/components/passenger/ride-history';
import { RideRequestForm } from '@/components/passenger/ride-request-form';
import { Alert, Reveal, SectionHeading, SkeletonRows } from '@/components/ui';
import { useActiveRide } from '@/hooks/use-rides';
import { useSession } from '@/hooks/use-session';

/**
 * The passenger's single screen.
 *
 * One page rather than a dashboard of links, because a passenger has exactly one
 * question at any moment: either "how do I get a ride" or "where is my ride". Which
 * of those is showing is decided by whether a live ride exists, not by navigation.
 */
export default function PassengerPage() {
  const { user } = useSession();
  const active = useActiveRide();

  /**
   * Held locally so the tracking view appears the instant a request succeeds,
   * without waiting for the rides list to refetch and agree.
   */
  const [justCreated, setJustCreated] = useState<number | null>(null);
  const rideId = active.rideId ?? justCreated;

  return (
    <AppShell role="PASSENGER" title={rideId ? 'Your ride' : 'Request a ride'}>
      <div className="space-y-8">
        <section>
          {active.isLoading && !justCreated ? (
            <SkeletonRows rows={2} />
          ) : active.error ? (
            <Alert tone="error" title="Could not check for an active ride">
              Reload the page to try again.
            </Alert>
          ) : rideId ? (
            <ActiveRide rideId={rideId} />
          ) : user ? (
            <RideRequestForm user={user} onCreated={setJustCreated} />
          ) : null}
        </section>

        <Reveal as="section" delay={120}>
          <SectionHeading>Past rides</SectionHeading>
          <RideHistory />
        </Reveal>
      </div>
    </AppShell>
  );
}
