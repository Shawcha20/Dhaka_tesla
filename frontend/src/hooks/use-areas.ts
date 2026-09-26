'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Area } from '@/lib/types';

/**
 * The twelve Dhaka areas.
 *
 * Reference data that changes roughly never, so it is cached for the whole session
 * rather than refetched on every mount — the ride form, the driver board and the
 * history list all need it, and three requests for the same twelve rows would be
 * waste.
 */
export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    queryFn: ({ signal }) => api.get<Area[]>('/areas', { signal }),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
