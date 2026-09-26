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
