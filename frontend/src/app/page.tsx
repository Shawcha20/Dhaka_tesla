'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button, Card, Reveal, Spinner } from '@/components/ui';
import { useSession } from '@/hooks/use-session';

/** The three things that happen, in order. */
const STEPS = [
  {
    title: 'Say where you are going',
    body: 'Pick your area and your destination. You see the fare before you commit — both the solo price and the shared one.',
  },
  {
    title: 'Get matched, or get matched with someone',
    body: 'A driver nearby accepts. If another rider is heading the same way, you share the Tesla and both fares drop.',
  },
  {
    title: 'Pay only your share',
    body: 'Wallet or cash, settled when you arrive. The fare is locked the moment the trip starts, so it cannot move under you.',
  },
];

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
    <main className="mx-auto min-h-dvh max-w-xl px-5 py-14">
      <Reveal className="flex items-center gap-3">
        <span
          className="from-brand-500 to-brand-700 shadow-lift grid size-11 place-items-center rounded-2xl bg-gradient-to-br"
          aria-hidden="true"
        >
          <span className="flex items-end gap-[3px]">
            <span className="h-3 w-2 rounded-sm bg-white" />
            <span className="h-4 w-2 rounded-sm bg-white" />
            <span className="h-3 w-2 rounded-sm bg-white/45" />
          </span>
        </span>
        <p className="text-brand-700 text-sm font-semibold tracking-wide uppercase">
          Dhaka Tesla Pool
        </p>
      </Reveal>

      <Reveal delay={80} className="mt-8">
        <h1 className="text-4xl font-bold tracking-tight text-balance text-neutral-900">
          Share a seat. Split the fare.{' '}
          <span className="from-brand-600 to-brand-400 bg-gradient-to-r bg-clip-text text-transparent">
            Survive Dhaka traffic.
          </span>
        </h1>
      </Reveal>

      <Reveal delay={150} className="mt-4">
        <p className="text-lg text-neutral-600">
          Request a ride across Dhaka and share a three-seat Tesla with someone heading the
          same way. You each pay your own discounted fare — never a split bill to argue
          about.
        </p>
      </Reveal>

      <Reveal delay={220} className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/signup" className="flex-1">
          <Button full>Create a passenger account</Button>
        </Link>
        <Link href="/login" className="flex-1">
          <Button full variant="secondary">
            Sign in
          </Button>
        </Link>
      </Reveal>

      <ol className="mt-12 space-y-3">
        {STEPS.map((step, index) => (
          <Reveal as="li" key={step.title} delay={300 + index * 90}>
            <Card interactive className="flex gap-4">
              <span
                className="bg-brand-100 text-brand-700 grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-neutral-900">{step.title}</p>
                <p className="mt-1 text-sm text-neutral-600">{step.body}</p>
              </div>
            </Card>
          </Reveal>
        ))}
      </ol>

      <Reveal delay={600} className="mt-10 text-sm text-neutral-500">
        <p>
          Drivers are registered by Dhaka Tesla Pool — onboarding one means verifying a
          licence and a vehicle, so it is not a self-signup.
        </p>
      </Reveal>
    </main>
  );
}
