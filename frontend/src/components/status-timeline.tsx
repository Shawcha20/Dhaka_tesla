import { cx } from '@/components/ui';
import { formatTime } from '@/lib/format';
import type { RideStatus, TimelineEntry } from '@/lib/types';

/** The stages a ride passes through, in order, for the progress rail. */
const STAGES: { status: RideStatus; label: string }[] = [
  { status: 'REQUESTED', label: 'Requested' },
  { status: 'MATCHED', label: 'Driver assigned' },
  { status: 'DRIVER_ARRIVED', label: 'Driver arrived' },
  { status: 'STARTED', label: 'On the way' },
  { status: 'COMPLETED', label: 'Arrived' },
];

/**
 * Progress rail plus the audit trail underneath.
 *
 * Two things are shown deliberately rather than one: the rail answers "where am I
 * now", and the entries answer "what happened and who did it". The second is the
 * brief's requirement that the system can explain a ride after the fact, and it is
 * the same history the driver and an auditor see.
 */
export function StatusTimeline({
  status,
  entries,
}: {
  status: RideStatus;
  entries: TimelineEntry[];
}) {
  const cancelled = status === 'CANCELLED';
  const reachedIndex = STAGES.findIndex((stage) => stage.status === status);

  /** When the ride was cancelled, progress stops at whatever it last reached. */
  const lastReached = cancelled
    ? STAGES.reduce((furthest, stage, index) => {
        const happened = entries.some((entry) => entry.toStatus === stage.status);
        return happened ? index : furthest;
      }, -1)
    : reachedIndex;

  return (
    <div className="space-y-5">
      <ol className="flex items-start gap-1" aria-label="Ride progress">
        {STAGES.map((stage, index) => {
          const done = index <= lastReached;
          const current = index === lastReached && !cancelled;

          return (
            <li key={stage.status} className="flex-1">
              {/**
               * The fill is an inner bar scaling from the left rather than a colour
               * swap, so when polling advances the ride a stage the rail visibly
               * extends into it. A CSS transition does not run on mount, which is the
               * behaviour wanted here: a ride already in progress renders its rail
               * filled, and only the stage reached while watching animates.
               */}
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                <div
                  className={cx(
                    'h-full origin-left rounded-full transition-transform duration-500 ease-out',
                    cancelled ? 'bg-rose-300' : 'bg-brand-500',
                    done ? 'scale-x-100' : 'scale-x-0',
                  )}
                  style={{ transitionDelay: `${index * 90}ms` }}
                />
              </div>
              <p
                className={cx(
                  'mt-1.5 text-[11px] leading-tight',
                  current
                    ? 'text-brand-700 font-semibold'
                    : done
                      ? 'text-neutral-600'
                      : 'text-neutral-400',
                )}
              >
                {stage.label}
              </p>
            </li>
          );
        })}
      </ol>

      {cancelled && (
        <p className="text-sm font-medium text-rose-700">This ride was cancelled.</p>
      )}

      <ol className="space-y-2.5 border-l border-neutral-200 pl-4">
        {entries.map((entry, index) => (
          <li
            key={index}
            className="animate-rise relative"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <span
              className={cx(
                'absolute top-1.5 -left-[21px] size-2 rounded-full ring-2 ring-white',
                entry.toStatus === 'CANCELLED' ? 'bg-rose-400' : 'bg-brand-400',
              )}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-neutral-800">
                {humanise(entry.toStatus)}
              </span>
              <span className="tabular text-xs text-neutral-500">
                {formatTime(entry.at)}
              </span>
              <span className="text-xs text-neutral-500">
                {/* SYSTEM entries are attributed honestly rather than blamed on a
                    person: a pool cancelled by its driver requeues the others, and
                    nobody chose that on their behalf. */}
                {entry.actorRole === 'SYSTEM' ? 'automatic' : `by ${entry.by}`}
              </span>
            </div>
            {entry.note && <p className="mt-0.5 text-xs text-neutral-500">{entry.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** `DRIVER_ARRIVED` → `Driver arrived`. Covers pool events too, e.g. MEMBER_JOINED. */
function humanise(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
