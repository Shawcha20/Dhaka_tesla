'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Alert, Badge, Button, Spinner } from '@/components/ui';
import { useLogout, useSession } from '@/hooks/use-session';
import { formatTaka } from '@/lib/format';
import type { Role } from '@/lib/types';

/**
 * Shared chrome for the signed-in sections, and the last line of access control.
 *
 * Middleware only checks that a cookie exists. This checks who the API says you
 * actually are, which is what catches an expired token or a passenger navigating to
 * a driver URL by hand.
 */
export function AppShell({
  role,
  title,
  children,
  actions,
}: {
  role: Role;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { user, isLoading, isUnauthenticated, error } = useSession();
  const logout = useLogout();

  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6 text-neutral-400" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  // Distinguished from "not signed in": if the API is unreachable, saying so is far
  // more useful than bouncing the user to a login page that will also fail.
  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <Alert tone="error" title="Cannot reach the API">
          The server did not respond. If you are running this locally, check that{' '}
          <code className="font-mono">docker compose up</code> is running.
        </Alert>
      </div>
    );
  }

  if (isUnauthenticated || !user) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <Alert tone="warning" title="Your session has ended">
          Please sign in again.
        </Alert>
        <Link href="/login" className="mt-4 block">
          <Button full>Sign in</Button>
        </Link>
      </div>
    );
  }

  if (user.role !== role) {
    const home = user.role === 'DRIVER' ? '/driver' : '/passenger';
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <Alert tone="warning" title="Wrong section">
          You are signed in as a {user.role.toLowerCase()}, and this page is for the other
          role.
        </Alert>
        <Link href={home} className="mt-4 block">
          <Button full>Go to your {user.role === 'DRIVER' ? 'driver' : 'rides'} page</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-brand-600 text-[11px] font-semibold tracking-wide uppercase">
              Dhaka Tesla Pool
            </p>
            <h1 className="truncate text-base font-semibold text-neutral-900">{title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Wallet balance is shown wherever a passenger is, because it decides
                whether a TeslaPay fare will settle. */}
            {user.walletBalancePaisa !== null && (
              <Badge className="bg-brand-50 text-brand-700 ring-brand-200 tabular">
                {formatTaka(user.walletBalancePaisa)}
              </Badge>
            )}
            {user.vehicle && (
              <Badge
                className={
                  user.vehicle.isOnline
                    ? 'bg-brand-50 text-brand-700 ring-brand-200'
                    : 'bg-neutral-100 text-neutral-600 ring-neutral-200'
                }
              >
                {user.vehicle.name} · {user.vehicle.isOnline ? 'online' : 'offline'}
              </Badge>
            )}
            <Button
              variant="ghost"
              className="px-2.5 py-1.5 text-xs"
              loading={logout.isPending}
              onClick={() => logout.mutate()}
            >
              Sign out
            </Button>
          </div>
        </div>
        {actions && (
          <div className="mx-auto max-w-3xl px-5 pb-3">{actions}</div>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <p className="sr-only">Signed in as {user.name}</p>
        {children}
      </main>
    </div>
  );
}
