'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button, Spinner } from '@/components/ui';
import { useSession } from '@/hooks/use-session';

/**
 * Landing page, and the router for an already-signed-in user.
 *
 * The two roles have genuinely different apps, so rather than one dashboard with
 * conditional halves, each role is sent to its own section.
 */
export default function HomePage() {
  const router = useRouter();
  const { user, isLoading } = useSession();

  useEffect(() => {
    if (!user) return;
    router.replace(user.role === 'DRIVER' ? '/driver' : '/passenger');
  }, [user, router]);

  if (isLoading || user) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner className="size-6 text-neutral-400" />
        <span className="sr-only">Loading…</span>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <div className="space-y-3">
        <p className="text-brand-600 text-sm font-semibold tracking-wide uppercase">
          Dhaka Tesla Pool
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 text-balance">
          Share a seat. Split the fare. Survive Dhaka traffic.
        </h1>
        <p className="text-neutral-600">
          Request a ride across Dhaka and share a three-seat Tesla with someone heading
          the same way. You each pay your own discounted fare.
        </p>
      </div>

      <div className="mt-8 space-y-3">
        <Link href="/signup" className="block">
          <Button full>Create a passenger account</Button>
        </Link>
        <Link href="/login" className="block">
          <Button full variant="secondary">
            Sign in
          </Button>
        </Link>
      </div>

      <div className="mt-10 rounded-xl bg-white p-4 ring-1 ring-neutral-200">
        <p className="text-sm font-medium text-neutral-800">Demo accounts</p>
        <p className="mt-1 text-sm text-neutral-500">
          Password <code className="font-mono">TeslaPool#2026</code> for all of them.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-neutral-600">
          <li>
            <span className="font-medium text-neutral-800">jashim@dhakatesla.test</span> —
            driver, owns Bullet
          </li>
          <li>
            <span className="font-medium text-neutral-800">nusrat@dhakatesla.test</span> —
            passenger
          </li>
          <li>
            <span className="font-medium text-neutral-800">rafiq@dhakatesla.test</span> —
            passenger
          </li>
        </ul>
      </div>
    </main>
  );
}
