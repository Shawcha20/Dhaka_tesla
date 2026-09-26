'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { SESSION_KEY } from '@/hooks/use-session';
import type { PaymentMethod, Quote, RideDetail, RideSummary } from '@/lib/types';

export const RIDES_KEY = ['rides'] as const;

/** Statuses where something is still going to happen, so the view must keep polling. */
const LIVE_STATUSES = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'] as const;

export function isLiveRide(status: RideDetail['status']): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

export interface QuoteInput {
  pickupAreaId: number | null;
  dropoffAreaId: number | null;
  seats: number;
}

/**
 * A fare estimate for the trip currently described in the form.
 *
 * Disabled until the form describes a real trip, so an incomplete selection does not
 * produce a pointless 422. Cached by its inputs, which means flipping back and forth
 * between two destinations is instant rather than two more round trips.
 */
export function useQuote(input: QuoteInput) {
  const ready =
    input.pickupAreaId !== null &&
    input.dropoffAreaId !== null &&
    input.pickupAreaId !== input.dropoffAreaId;

  return useQuery({
    queryKey: ['quote', input.pickupAreaId, input.dropoffAreaId, input.seats],
    queryFn: () =>
      api.post<Quote>('/rides/quote', {
        pickupAreaId: input.pickupAreaId,
        dropoffAreaId: input.dropoffAreaId,
        seats: input.seats,
      }),
    enabled: ready,
    // The fare for a given trip is deterministic, so there is nothing to refetch.
    staleTime: 5 * 60_000,
  });
}

export function useMyRides() {
  return useQuery({
    queryKey: [...RIDES_KEY, 'mine'],
    queryFn: ({ signal }) =>
      api.getWithMeta<RideSummary[], { nextCursor: string | null }>('/rides/mine?limit=20', {
        signal,
      }),
  });
}

/**
 * One ride, polled while it is still live.
 *
 * Polling rather than a WebSocket: the events here are human-paced — a driver
 * accepting, arriving, setting off — so a few seconds of latency is invisible, and a
 * socket would add connection lifecycle and auth-on-upgrade for no felt gain.
 *
 * The interval returns false once the ride reaches a terminal state, so a completed
 * ride left open in a tab stops making requests entirely.
 */
export function useRide(rideId: number | null) {
  return useQuery({
    queryKey: [...RIDES_KEY, rideId],
    queryFn: ({ signal }) => api.get<RideDetail>(`/rides/${rideId}`, { signal }),
    enabled: rideId !== null,
    refetchInterval: (query) => {
      const ride = query.state.data;
      if (!ride) return 4_000;
      return isLiveRide(ride.status) ? 4_000 : false;
    },
  });
}

export interface CreateRideInput {
  pickupAreaId: number;
  dropoffAreaId: number;
  seats: number;
  paymentMethod: PaymentMethod;
}

export function useCreateRide() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRideInput) => api.post<RideDetail>('/rides', input),
    onSuccess: (ride) => {
      // Seed the detail cache so the tracking view renders immediately instead of
      // showing a spinner for data we already hold.
      queryClient.setQueryData([...RIDES_KEY, ride.id], ride);
      void queryClient.invalidateQueries({ queryKey: RIDES_KEY });
    },
  });
}

export function useCancelRide() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rideId, reason }: { rideId: number; reason?: string }) =>
      api.patch<RideDetail>(`/rides/${rideId}/cancel`, reason ? { reason } : {}),
    onSuccess: (ride) => {
      queryClient.setQueryData([...RIDES_KEY, ride.id], ride);
      void queryClient.invalidateQueries({ queryKey: RIDES_KEY });
      // Cancelling can release a TeslaPay hold, and the header shows the balance.
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

/** The ride the passenger is currently on, if any. */
export function useActiveRide() {
  const rides = useMyRides();
  const active = rides.data?.data.find((ride) => isLiveRide(ride.status)) ?? null;

  return {
    rideId: active?.id ?? null,
    isLoading: rides.isLoading,
    error: rides.error,
    refetch: rides.refetch,
  };
}
