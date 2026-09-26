'use client';

import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/ui';

/** Filled in by the passenger UI phase: request form, live fare, status timeline. */
export default function PassengerPage() {
  return (
    <AppShell role="PASSENGER" title="Your rides">
      <EmptyState title="Passenger screens are next">
        Requesting a ride, the live fare quote, the status timeline and your history land
        in the following phase.
      </EmptyState>
    </AppShell>
  );
}
