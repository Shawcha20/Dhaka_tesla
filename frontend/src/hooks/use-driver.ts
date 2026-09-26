'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SESSION_KEY } from '@/hooks/use-session';
import { api } from '@/lib/api';
import type {
  DriverRequest,
  PoolDetail,
  SettlementLine,
  TripHistoryEntry,
  Vehicle,
} from '@/lib/types';

export const DRIVER_KEY = ['driver'] as const;

/** A pool in any of these states occupies the driver. */
const ACTIVE_POOL = ['FORMING', 'DRIVER_ARRIVED', 'STARTED'] as const;

export function isActivePool(status: PoolDetail['status']): boolean {
  return (ACTIVE_POOL as readonly string[]).includes(status);
}

/** Everything the driver's screen needs, refetched together after any action. */
function invalidateDriver(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: DRIVER_KEY });
}

export function useVehicleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (isOnline: boolean) =>
      api.patch<Vehicle>('/driver/status', { isOnline }),
    onSuccess: () => {
      // The header badge reads the vehicle off the session, so both must refresh.
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      invalidateDriver(queryClient);
    },
  });
}

export interface RequestFeed {
  pool: { id: number; seatsTaken: number; capacity: number } | null;
  data: DriverRequest[];
}

/**
 * Open requests, polled while the driver is online.
 *
 * Faster than the passenger's poll because this is the driver's working screen — a
 * request that appears six seconds late is a fare lost to whoever refreshed sooner.
 * Polling stops entirely when offline, since there is nothing to act on.
 */
export function useRequestFeed(options: { enabled: boolean }) {
  return useQuery({
    queryKey: [...DRIVER_KEY, 'requests'],
    queryFn: ({ signal }) => api.get<RequestFeed>('/driver/requests', { signal }),
    enabled: options.enabled,
    refetchInterval: options.enabled ? 4_000 : false,
    // The feed is a live list, so a stale render is worse than a brief spinner.
    placeholderData: (previous) => previous,
  });
}

export function useCurrentPool() {
  return useQuery({
    queryKey: [...DRIVER_KEY, 'pool', 'current'],
    queryFn: ({ signal }) => api.get<PoolDetail | null>('/driver/pools/current', { signal }),
    refetchInterval: (query) => {
      const pool = query.state.data;
      if (!pool) return 6_000;
      return isActivePool(pool.status) ? 4_000 : false;
    },
  });
}

export function useTripHistory() {
  return useQuery({
    queryKey: [...DRIVER_KEY, 'pools'],
    queryFn: ({ signal }) =>
      api.getWithMeta<TripHistoryEntry[], { nextCursor: string | null }>(
        '/driver/pools?limit=20',
        { signal },
      ),
  });
}

/** Accept a request, opening a pool around it. */
export function useCreatePool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rideRequestId: number) =>
      api.post<PoolDetail>('/driver/pools', { rideRequestId }),
    onSuccess: (pool) => {
      queryClient.setQueryData([...DRIVER_KEY, 'pool', 'current'], pool);
      invalidateDriver(queryClient);
    },
  });
}

/** Add a passenger to a forming pool — the contested operation. */
export function useAddMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ poolId, rideRequestId }: { poolId: number; rideRequestId: number }) =>
      api.post<PoolDetail>(`/driver/pools/${poolId}/members`, { rideRequestId }),
    onSuccess: (pool) => {
      queryClient.setQueryData([...DRIVER_KEY, 'pool', 'current'], pool);
      invalidateDriver(queryClient);
    },
    onError: () => {
      /**
       * Refetch on failure too, and deliberately.
       *
       * The most likely reason a join fails is that the seat went to someone else,
       * which means the board on screen is already out of date. Leaving it showing a
       * seat that no longer exists would invite the driver to try again and fail
       * again.
       */
      invalidateDriver(queryClient);
    },
  });
}

type TripAction = 'arrive' | 'start' | 'complete';

export function useTripAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ poolId, action }: { poolId: number; action: TripAction }) => {
      if (action === 'complete') {
        // Completion is the one action with a payload worth showing: which fares
        // settled and which failed.
        return api.patchWithMeta<PoolDetail, { settlement: SettlementLine[] }>(
          `/driver/pools/${poolId}/complete`,
        );
      }
      const pool = await api.patch<PoolDetail>(`/driver/pools/${poolId}/${action}`);
      return { data: pool, meta: { settlement: [] as SettlementLine[] } };
    },
    onSuccess: ({ data }) => {
      queryClient.setQueryData([...DRIVER_KEY, 'pool', 'current'], data);
      invalidateDriver(queryClient);
      // Completing settles money, which can move the driver's own figures.
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

export function useCancelPool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ poolId, reason }: { poolId: number; reason?: string }) =>
      api.patch<PoolDetail>(`/driver/pools/${poolId}/cancel`, reason ? { reason } : {}),
    onSuccess: (pool) => {
      queryClient.setQueryData([...DRIVER_KEY, 'pool', 'current'], pool);
      invalidateDriver(queryClient);
    },
  });
}
