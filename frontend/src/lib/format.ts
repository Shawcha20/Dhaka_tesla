import type { PoolStatus, RideStatus } from './types';

/**
 * The single place paisa becomes something a person reads.
 *
 * Built by string arithmetic rather than dividing by 100, for the same reason the
 * backend stores integers: `4159 / 100` is fine, but the habit of dividing money
 * is how rounding errors get in. Keeping one formatter also means the app cannot
 * disagree with itself about how much a ride costs.
 */
export function formatPaisa(paisa: number): string {
  const negative = paisa < 0;
  const absolute = Math.abs(Math.trunc(paisa));
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}.${String(fraction).padStart(2, '0')}`;
}

export function formatTaka(paisa: number): string {
  return `৳${formatPaisa(paisa)}`;
}

/** `1.799` → `1.8 km`. Three decimals are for the fare maths, not for a person. */
export function formatKm(km: string): string {
  const value = Number(km);
  return Number.isFinite(value) ? `${value.toFixed(1)} km` : `${km} km`;
}

/**
 * Passenger-facing status wording. The API uses STARTED; the brief describes it to
 * passengers as "in progress", and the UI should speak the user's language.
 */
const RIDE_LABELS: Record<RideStatus, string> = {
  REQUESTED: 'Looking for a Tesla',
  MATCHED: 'Driver assigned',
  DRIVER_ARRIVED: 'Driver has arrived',
  STARTED: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function rideStatusLabel(status: RideStatus): string {
  return RIDE_LABELS[status];
}

const POOL_LABELS: Record<PoolStatus, string> = {
  FORMING: 'Taking passengers',
  DRIVER_ARRIVED: 'At pickup',
  STARTED: 'On the road',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function poolStatusLabel(status: PoolStatus): string {
  return POOL_LABELS[status];
}

/** Tailwind classes per status, so colour is consistent wherever a badge appears. */
export function rideStatusTone(status: RideStatus): string {
  switch (status) {
    case 'REQUESTED':
      return 'bg-amber-100 text-amber-900 ring-amber-200';
    case 'MATCHED':
    case 'DRIVER_ARRIVED':
      return 'bg-sky-100 text-sky-900 ring-sky-200';
    case 'STARTED':
      return 'bg-brand-100 text-brand-700 ring-brand-200';
    case 'COMPLETED':
      return 'bg-neutral-100 text-neutral-700 ring-neutral-200';
    case 'CANCELLED':
      return 'bg-rose-100 text-rose-900 ring-rose-200';
  }
}

/** Dhaka time, since that is where every user of this app is. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  });
}

/** `118` → `2m ago`, for the driver's request feed. */
export function formatWaiting(seconds: number): string {
  if (seconds < 60) return `${seconds}s waiting`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m waiting`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m waiting`;
}
