'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Alert, Button, Field, Reveal, Spinner, TextInput } from '@/components/ui';
import { SESSION_KEY } from '@/hooks/use-session';
import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

/**
 * Where to go after signing in.
 *
 * Middleware puts the page you were trying to reach in `?next=`, and honouring it is
 * the difference between "sign in and carry on" and "sign in and start over". Only a
 * same-site absolute path is accepted: anything else — a full URL, or `//evil.test`,
 * which a browser reads as protocol-relative — would turn this form into an
 * open redirect that a phishing link could point wherever it liked.
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

/**
 * The Suspense boundary is required, not decorative: `useSearchParams` makes a
 * component depend on the request URL, and Next refuses to prerender a page that
 * reads it without one. Everything above the form is URL-independent, so only the
 * form sits inside.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Reveal>
        <Link
          href="/"
          className="text-brand-600 hover:text-brand-700 text-sm font-semibold transition-colors"
        >
          ← Dhaka Tesla Pool
        </Link>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-neutral-900">Sign in</h1>
      </Reveal>

      <Suspense
        fallback={
          <div className="mt-10 grid place-items-center">
            <Spinner className="size-5 text-neutral-400" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}

function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const next = safeNext(searchParams.get('next'));
  // Set by the password-change flow, which ends every session on purpose. Without
  // this the user would land here with no explanation and assume something broke.
  const passwordChanged = searchParams.get('changed') === '1';

  const login = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.post<{ user: SessionUser }>('/auth/login', credentials),
    onSuccess: async () => {
      /**
       * Refetch the session rather than seeding the cache from the login response.
       *
       * Login returns the bare user; `/auth/me` also returns the vehicle and wallet
       * balance. Writing the smaller shape into the cache would leave the app
       * briefly believing a driver has no Tesla.
       */
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      const me = await queryClient.fetchQuery({
        queryKey: SESSION_KEY,
        queryFn: () => api.get<SessionUser>('/auth/me'),
      });
      router.replace(next ?? (me.role === 'DRIVER' ? '/driver' : '/passenger'));
    },
  });

  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <>
      <Reveal delay={80}>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate({ email: email.trim(), password });
          }}
        >
          {passwordChanged && !error && (
            <Alert tone="success" title="Password changed">
              Sign in again with your new password.
            </Alert>
          )}

          {error && (
            <Alert tone="error">
              {error.message}
              {/* The request id makes a user-reported failure traceable to a log line. */}
              {error.status >= 500 && error.requestId && (
                <span className="mt-1 block font-mono text-xs opacity-70">
                  ref {error.requestId}
                </span>
              )}
            </Alert>
          )}

          <Field label="Email" htmlFor="email" error={error?.fieldErrors['email']}>
            <TextInput
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              invalid={Boolean(error?.fieldErrors['email'])}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>

          <Field label="Password" htmlFor="password" error={error?.fieldErrors['password']}>
            <TextInput
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              invalid={Boolean(error?.fieldErrors['password'])}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" full loading={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 text-sm text-neutral-600">
          No account?{' '}
          <Link href="/signup" className="text-brand-600 font-medium hover:underline">
            Sign up as a passenger
          </Link>
        </p>
      </Reveal>
    </>
  );
}
