'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Alert, Avatar, Badge, Button, Reveal, Spinner } from '@/components/ui';
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
  /** Omitted on pages that belong to both roles, such as the profile page. */
  back,
}: {
  role?: Role;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
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
      <div className="animate-rise mx-auto max-w-md px-5 py-16">
        <Alert tone="error" title="Cannot reach the API">
          The server did not respond. If you are running this locally, check that{' '}
          <code className="font-mono">docker compose up</code> is running.
        </Alert>
      </div>
    );
  }

  if (isUnauthenticated || !user) {
    return (
      <div className="animate-rise mx-auto max-w-md px-5 py-16">
        <Alert tone="warning" title="Your session has ended">
          Please sign in again.
        </Alert>
        <Link href="/login" className="mt-4 block">
          <Button full>Sign in</Button>
        </Link>
      </div>
    );
  }

  if (role && user.role !== role) {
    const home = user.role === 'DRIVER' ? '/driver' : '/passenger';
    return (
      <div className="animate-rise mx-auto max-w-md px-5 py-16">
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
      <header className="sticky top-0 z-10 border-b border-neutral-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              {back ? (
                <Link
                  href={back.href}
                  className="text-brand-600 hover:text-brand-700 text-[11px] font-semibold tracking-wide uppercase transition-colors"
                >
                  ← {back.label}
                </Link>
              ) : (
                <p className="text-brand-600 text-[11px] font-semibold tracking-wide uppercase">
                  Dhaka Tesla Pool
                </p>
              )}
              <h1 className="truncate text-base font-semibold text-neutral-900">{title}</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Wallet balance is shown wherever a passenger is, because it decides
                whether a TeslaPay fare will settle. */}
            {user.walletBalancePaisa !== null && (
              <Badge className="bg-brand-50 text-brand-700 ring-brand-200 tabular hidden sm:inline-flex">
                {formatTaka(user.walletBalancePaisa)}
              </Badge>
            )}
            {user.vehicle && (
              <Badge
                className={
                  user.vehicle.isOnline
                    ? 'bg-brand-50 text-brand-700 ring-brand-200 hidden sm:inline-flex'
                    : 'hidden bg-neutral-100 text-neutral-600 ring-neutral-200 sm:inline-flex'
                }
              >
                {user.vehicle.name} · {user.vehicle.isOnline ? 'online' : 'offline'}
              </Badge>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              loading={logout.isPending}
              onClick={() => logout.mutate()}
            >
              Sign out
            </Button>

            {/* The avatar is the way into account settings, which is where the
                signed-in name, phone and password live. */}
            <Link
              href="/profile"
              aria-label="Your account"
              title="Your account"
              className="focus-visible:outline-brand-600 rounded-full transition-transform duration-150 hover:scale-105 active:scale-95"
            >
              <Avatar name={user.name} />
            </Link>
          </div>
        </div>

        {actions && <div className="mx-auto max-w-3xl px-5 pb-3">{actions}</div>}
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <p className="sr-only">Signed in as {user.name}</p>
        <Reveal>{children}</Reveal>
      </main>
    </div>
  );
}

/**
 * The mark: three seats, two filled.
 *
 * Drawn rather than an image file so it scales and inherits colour, and chosen to
 * say what the product is at a glance — a shared vehicle, partly full.
 */
function BrandMark() {
  return (
    <span
      className="from-brand-500 to-brand-700 shadow-soft grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br"
      aria-hidden="true"
    >
      <span className="flex items-end gap-[3px]">
        <span className="h-2.5 w-1.5 rounded-sm bg-white" />
        <span className="h-3.5 w-1.5 rounded-sm bg-white" />
        <span className="h-2.5 w-1.5 rounded-sm bg-white/45" />
      </span>
    </span>
  );
}
