'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { api, ApiError } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

export const SESSION_KEY = ['session'] as const;

/**
 * The signed-in user, from `GET /auth/me`.
 *
 * The access token lives in an httpOnly cookie, so the client cannot read it —
 * asking the API who it thinks we are is the only honest way to know. That also
 * means the answer reflects the server's view rather than a decoded token that
 * might name a deleted or disabled account.
 */
export function useSession() {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => api.get<SessionUser>('/auth/me', { signal }),
    // A 401 here is a normal answer ("nobody is signed in"), not a failure worth
    // retrying or surfacing as an error state.
    retry: false,
    staleTime: 30_000,
  });

  const unauthenticated =
    query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    /** Resolved and definitely not signed in. */
    isUnauthenticated: unauthenticated,
    /** A real problem — the API is down, not merely unauthenticated. */
    error: unauthenticated ? null : query.error,
    refetch: query.refetch,
  };
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => api.post<null>('/auth/logout'),
    onSettled: () => {
      /**
       * Clears every cached query, not just the session.
       *
       * Ride history and pool state belong to the person who just left; leaving
       * them in the cache means the next user to sign in on this browser could see
       * a flash of someone else's data before their own loads.
       */
      queryClient.clear();
      router.replace('/login');
    },
  });
}

/**
 * Edits the signed-in user's own name or phone.
 *
 * The API returns the full `/auth/me` shape, so the response is written straight
 * into the session cache rather than triggering a refetch — the answer is already
 * here, and refetching would make the header flicker back to the old name first.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name?: string; phone?: string | null }) =>
      api.patch<SessionUser>('/auth/me', input),
    onSuccess: (user) => {
      queryClient.setQueryData(SESSION_KEY, user);
    },
  });
}

/**
 * Changes the password, which ends every session including this one.
 *
 * The API clears the auth cookies on success, so there is nothing to stay on: the
 * only honest next screen is the sign-in form. Treating that as a success rather than
 * as being kicked out is why it carries the `changed` flag.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<null>('/auth/password', input),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login?changed=1');
    },
  });
}
