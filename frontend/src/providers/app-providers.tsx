'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api';

/**
 * Created inside a `useState` initialiser rather than at module scope.
 *
 * A module-level client would be shared across every request on the server, which
 * means one user's cached data could be served to another. Per-mount is the
 * documented pattern for the App Router and the only safe one.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Ride and pool state changes while the user watches, so cached data
             * goes stale almost immediately. Individual screens set their own
             * polling interval; this only stops Query serving a stale answer
             * without checking.
             */
            staleTime: 0,
            refetchOnWindowFocus: true,

            retry: (failureCount, error) => {
              /**
               * Never retry a 4xx. A 401 means sign in, a 409 means the seat is
               * gone — repeating either is pointless and, on a write, potentially
               * harmful. Only transient failures are worth another attempt.
               */
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // Mutations are never retried automatically: the user asked once, and
            // silently repeating a "claim this seat" is not ours to decide.
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
