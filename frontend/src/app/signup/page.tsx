'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert, Button, Field, TextInput } from '@/components/ui';
import { SESSION_KEY } from '@/hooks/use-session';
import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

interface SignupForm {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<SignupForm>({
    name: '',
    email: '',
    phone: '',
    password: '',
  });

  const update = <K extends keyof SignupForm>(key: K, value: SignupForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const signup = useMutation({
    mutationFn: (input: SignupForm) =>
      api.post<{ user: SessionUser }>('/auth/register', {
        name: input.name.trim(),
        email: input.email.trim(),
        // Omitted rather than sent empty: the API validates the format when present,
        // and an empty string would fail that check.
        ...(input.phone.trim() ? { phone: input.phone.trim() } : {}),
        password: input.password,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      router.replace('/passenger');
    },
  });

  const error = signup.error instanceof ApiError ? signup.error : null;
  const fieldError = (name: string) => error?.fieldErrors[name];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="text-brand-600 text-sm font-semibold hover:underline">
        ← Dhaka Tesla Pool
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight text-neutral-900">
        Create an account
      </h1>
      <p className="mt-1.5 text-sm text-neutral-600">
        Signing up creates a passenger account. Drivers are registered by Dhaka Tesla
        Pool, because onboarding one means verifying a licence and a vehicle.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          signup.mutate(form);
        }}
      >
        {/* Only shown when the failure is not attributable to a specific field,
            otherwise the same message would appear twice. */}
        {error && error.details.length === 0 && <Alert tone="error">{error.message}</Alert>}

        <Field label="Full name" htmlFor="name" error={fieldError('name')}>
          <TextInput
            id="name"
            type="text"
            autoComplete="name"
            required
            value={form.name}
            invalid={Boolean(fieldError('name'))}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Nusrat Jahan"
          />
        </Field>

        <Field label="Email" htmlFor="email" error={fieldError('email')}>
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            invalid={Boolean(fieldError('email'))}
            onChange={(e) => update('email', e.target.value)}
          />
        </Field>

        <Field
          label="Phone"
          htmlFor="phone"
          error={fieldError('phone')}
          hint="Optional. Bangladeshi mobile, e.g. +8801711000002"
        >
          <TextInput
            id="phone"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            invalid={Boolean(fieldError('phone'))}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="+8801711000002"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={fieldError('password')}
          hint="At least 10 characters. Length matters more than symbols."
        >
          <TextInput
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.password}
            invalid={Boolean(fieldError('password'))}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>

        <Button type="submit" full loading={signup.isPending}>
          {signup.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-5 text-sm text-neutral-600">
        Already have an account?{' '}
        <Link href="/login" className="text-brand-600 font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
