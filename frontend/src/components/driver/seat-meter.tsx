import { cx } from '@/components/ui';

/**
 * Seats used against capacity, as discrete blocks rather than a percentage bar.
 *
 * A three-seat vehicle has three states that matter, and a driver needs to read
 * "one seat left" at a glance rather than infer it from 67%. Blocks also make the
 * invariant visible: there are exactly `capacity` of them, so an overbooked pool
 * would be obviously wrong on screen rather than quietly over 100%.
 */
export function SeatMeter({
  seatsTaken,
  capacity,
  className,
}: {
  seatsTaken: number;
  capacity: number;
  className?: string;
}) {
  const free = Math.max(0, capacity - seatsTaken);

  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <div
        className="flex gap-1"
        role="img"
        aria-label={`${seatsTaken} of ${capacity} seats taken`}
      >
        {Array.from({ length: capacity }).map((_, index) => {
          const taken = index < seatsTaken;
          return (
            <span
              key={index}
              className={cx(
                // The colour transition is what makes a seat filling read as an
                // event. Staggering by index means three seats filling at once
                // sweep left to right instead of flicking over together.
                'h-6 w-4 rounded-sm ring-1 ring-inset transition-colors duration-300',
                taken ? 'bg-brand-500 ring-brand-600' : 'bg-neutral-100 ring-neutral-300',
              )}
              style={{ transitionDelay: `${index * 70}ms` }}
            />
          );
        })}
      </div>
      <span
        // Keyed on the count so the label pops when it changes — the number a driver
        // is actually watching.
        key={free}
        className="tabular animate-pop text-sm font-medium text-neutral-700"
      >
        {free === 0 ? 'Full' : `${free} ${free === 1 ? 'seat' : 'seats'} free`}
      </span>
    </div>
  );
}
