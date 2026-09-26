'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert, Button, Field, TextInput } from '@/components/ui';
import { SESSION_KEY } from '@/hooks/use-session';
import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

const DEMO_ACCOUNTS = [
  { label: 'Jashim (driver)', email: 'jashim@dhakatesla.test' },
  { label: 'Nusrat', email: 'nusrat@dhakatesla.test' },
  { label: 'Rafiq', email: 'rafiq@dhakatesla.test' },
  { label: 'Shirin', email: 'shirin@dhakatesla.test' },
];

const DEMO_PASSWORD = 'TeslaPool#2026';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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
      router.replace(me.role === 'DRIVER' ? '/driver' : '/passenger');
    },
  });

  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="text-brand-600 text-sm font-semibold hover:underline">
        ← Dhaka Tesla Pool
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight text-neutral-900">Sign in</h1>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ email: email.trim(), password });
        }}
      >
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
            placeholder="nusrat@dhakatesla.test"
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

      <div className="mt-8 rounded-xl bg-white p-4 ring-1 ring-neutral-200">
        <p className="text-sm font-medium text-neutral-800">Demo accounts</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              // Fills the form rather than signing in directly, so it is obvious
              // which account is about to be used.
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
              className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200"
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
