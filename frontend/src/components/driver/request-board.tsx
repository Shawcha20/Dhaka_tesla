'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Reveal,
  SkeletonRows,
} from '@/components/ui';
import { useAddMember, useCreatePool, useRequestFeed, type RequestFeed } from '@/hooks/use-driver';
import { ApiError } from '@/lib/api';
import { formatKm, formatTaka, formatWaiting } from '@/lib/format';
import type { DriverRequest, PoolabilityReason } from '@/lib/types';

/**
 * Why a request cannot be pooled, in the driver's language.
 *
 * Shown rather than hidden, which is the whole point: a request that silently
 * vanished would leave the driver guessing at the matching rule. Naming the reason
 * turns an opaque algorithm into one they can predict.
 */
const REFUSALS: Record<PoolabilityReason, string> = {
  DIFFERENT_PICKUP_AREA: 'Waiting somewhere else',
  ROUTE_NOT_COMPATIBLE: 'Heading a different way',
  NOT_ENOUGH_SEATS: 'Needs more seats than you have left',
  POOL_NOT_FORMING: 'Your Tesla has already set off',
};

export function RequestBoard({ isOnline }: { isOnline: boolean }) {
  const feed = useRequestFeed({ enabled: isOnline });

  if (!isOnline) {
    return (
      <EmptyState title="You are offline" icon={<OfflineIcon />}>
        Go online to see who is waiting for a ride.
      </EmptyState>
    );
  }

  if (feed.isLoading) return <SkeletonRows rows={2} />;

  if (feed.error) {
    return (
      <Alert tone="error" title="Could not load waiting passengers">
        The list will retry on its own. If it keeps failing, reload the page.
      </Alert>
    );
  }

  const requests = feed.data?.data ?? [];

  if (requests.length === 0) {
    return (
      <EmptyState title="Nobody waiting right now" icon={<WaitingIcon />}>
        New requests appear here automatically — no need to refresh.
      </EmptyState>
    );
  }

  const poolable = requests.filter((r) => r.poolable.eligible);
  const rest = requests.filter((r) => !r.poolable.eligible);

  return (
    <div className="space-y-3">
      {/* Ordered so the actionable ones are first: the driver's attention is the
          scarce resource, not screen space. */}
      {poolable.map((request, index) => (
        <Reveal key={request.id} delay={index * 60}>
          <RequestCard request={request} pool={feed.data?.pool ?? null} />
        </Reveal>
      ))}

      {rest.length > 0 && (
        <>
          <p className="pt-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Cannot share these right now
          </p>
          {rest.map((request, index) => (
            <Reveal key={request.id} delay={(poolable.length + index) * 60}>
              <RequestCard request={request} pool={feed.data?.pool ?? null} />
            </Reveal>
          ))}
        </>
      )}
    </div>
  );
}

function RequestCard({
  request,
  pool,
}: {
  request: DriverRequest;
  pool: RequestFeed['pool'];
}) {
  const createPool = useCreatePool();
  const addMember = useAddMember();

  const pending = createPool.isPending || addMember.isPending;
  const rawError = createPool.error ?? addMember.error;
  const error = rawError instanceof ApiError ? rawError : null;

  const eligible = request.poolable.eligible;
  const hasPool = pool !== null;

  return (
    <Card
      interactive={eligible}
      className={eligible ? 'border-l-brand-400 border-l-4' : 'opacity-70'}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-neutral-900">
            {request.pickupArea.name}
            <ArrowIcon />
            {request.dropoffArea.name}
          </p>
          <p className="mt-0.5 text-sm text-neutral-600">
            {request.passenger.name} · {request.seats}{' '}
            {request.seats === 1 ? 'seat' : 'seats'} · {formatKm(request.distanceKm)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {formatWaiting(request.waitingSeconds)}
          </p>
        </div>

        <div className="text-right">
          {/* The shared price is the headline, because that is what the driver is
              actually offering once a second passenger is aboard. */}
          <p className="tabular text-lg font-semibold text-neutral-900">
            {formatTaka(request.pooledFarePaisa)}
          </p>
          <p className="tabular text-xs text-neutral-500">
            {formatTaka(request.estimatedFarePaisa)} alone
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {eligible ? (
            request.poolable.bearingDiffDeg !== null ? (
              <Badge className="bg-brand-50 text-brand-700 ring-brand-200">
                {/* The number the rule actually used, so the decision is inspectable
                    rather than a black box. */}
                {request.poolable.bearingDiffDeg}° off your route
              </Badge>
            ) : (
              <Badge className="bg-brand-50 text-brand-700 ring-brand-200">
                Same direction
              </Badge>
            )
          ) : (
            <Badge className="bg-amber-50 text-amber-900 ring-amber-200">
              {request.poolable.reason ? REFUSALS[request.poolable.reason] : 'Cannot share'}
              {request.poolable.reason === 'ROUTE_NOT_COMPATIBLE' &&
                request.poolable.bearingDiffDeg !== null &&
                ` · ${request.poolable.bearingDiffDeg}° apart`}
            </Badge>
          )}
        </div>

        <Button
          variant={eligible ? 'primary' : 'secondary'}
          size="sm"
          loading={pending}
          disabled={!eligible}
          onClick={() => {
            if (hasPool) {
              addMember.mutate({ poolId: pool.id, rideRequestId: request.id });
            } else {
              createPool.mutate(request.id);
            }
          }}
        >
          {hasPool ? 'Add to trip' : 'Accept'}
        </Button>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">
            {error.code === 'POOL_CAPACITY_EXCEEDED'
              ? 'That seat has just gone. The list has been refreshed.'
              : error.code === 'RIDE_ALREADY_MATCHED'
                ? 'Another driver accepted this one first.'
                : error.message}
          </Alert>
        </div>
      )}
    </Card>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="text-brand-500 size-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 8h12m0 0-4-4m4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WaitingIcon() {
  return (
    <svg className="size-8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7.5V12l3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OfflineIcon() {
  return (
    <svg className="size-8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
