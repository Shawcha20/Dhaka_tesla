'use client';

import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/ui';

/** Filled in by the driver UI phase: request board, seat meter, trip controls. */
export default function DriverPage() {
  return (
    <AppShell role="DRIVER" title="Bullet">
      <EmptyState title="Driver screens are next">
        The request board with poolability reasons, the seat meter and the trip controls
        land in the following phase.
      </EmptyState>
    </AppShell>
  );
}
