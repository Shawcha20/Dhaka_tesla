import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/** Tiny class joiner. A dependency for this would be silly. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  full?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-soft hover:bg-brand-700 hover:shadow-lift disabled:bg-brand-600/50 disabled:shadow-none',
  secondary:
    'bg-white text-neutral-800 ring-1 ring-neutral-300 hover:bg-neutral-50 hover:ring-neutral-400 disabled:text-neutral-400',
  danger:
    'bg-rose-600 text-white shadow-soft hover:bg-rose-700 disabled:bg-rose-600/50 disabled:shadow-none',
  ghost: 'text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-xs',
  md: 'gap-2 px-4 py-2.5 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  full = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Disabled while loading, so a double-click cannot fire a second request.
      // The backend is idempotent where it matters, but the UI should not rely on
      // that to avoid a duplicate.
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium',
        // The press scale is the only feedback a touch user gets before the network
        // answers, so it is fast enough to land under the finger.
        'transition-all duration-150 active:scale-[0.97] disabled:active:scale-100',
        'disabled:cursor-not-allowed',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('size-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Accessible on/off switch — used for the driver's online state.
 *
 * A `role="switch"` button rather than a styled checkbox: the thing being toggled is
 * a server-side fact, so it needs a pending state, and a checkbox that snaps before
 * the request lands would tell a driver they are online when they are not. `checked`
 * is therefore always the server's answer, never local state.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  pending = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || pending}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-brand-600' : 'bg-neutral-300',
      )}
    >
      <span
        className={cx(
          'grid size-5 place-items-center rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-out',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      >
        {pending && <Spinner className="text-brand-600 size-3" />}
      </span>
    </button>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-neutral-800">
        {label}
      </label>
      {children}
      {/* role="alert" so a screen reader announces a validation failure rather
          than leaving it silently on screen. */}
      {error ? (
        <p role="alert" className="animate-slide-down text-sm text-rose-700">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function TextInput({ invalid, className, ...rest }: TextInputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(
        'block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm text-neutral-900 ring-1 ring-inset',
        'transition-shadow duration-150 focus:ring-2',
        'placeholder:text-neutral-400 disabled:bg-neutral-100 disabled:text-neutral-500',
        invalid ? 'ring-rose-400 focus:ring-rose-500' : 'focus:ring-brand-500 ring-neutral-300',
        className,
      )}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cx(
        'block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm text-neutral-900 ring-1 ring-inset',
        'transition-shadow duration-150 focus:ring-2',
        'disabled:bg-neutral-100 disabled:text-neutral-500',
        invalid ? 'ring-rose-400 focus:ring-rose-500' : 'focus:ring-brand-500 ring-neutral-300',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    error: 'bg-rose-50 text-rose-900 ring-rose-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
    success: 'bg-brand-50 text-brand-700 ring-brand-200',
  };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'animate-slide-down rounded-lg px-3.5 py-3 text-sm ring-1 ring-inset',
        tones[tone],
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-0.5' : undefined}>{children}</div>
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        'transition-colors duration-200',
        className ?? 'bg-neutral-100 text-neutral-700 ring-neutral-200',
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  interactive = false,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  /** Lifts on hover. For cards that are themselves the thing being acted on. */
  interactive?: boolean;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  return (
    <Tag
      className={cx(
        'shadow-soft rounded-xl bg-white p-4 ring-1 ring-neutral-200/80',
        interactive &&
          'hover:shadow-lift transition-all duration-200 hover:-translate-y-0.5 hover:ring-neutral-300',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Entrance animation wrapper.
 *
 * One component rather than animation classes sprinkled across the app, so every
 * list and panel arrives the same way. `delay` staggers siblings: about 60ms apart
 * reads as a sequence, while much more than that starts to feel like the page is
 * loading slowly.
 *
 * Deliberately keyed on nothing — a re-render from polling does not restart a CSS
 * animation, so rows already on screen stay still and only genuinely new ones
 * animate in. That is the behaviour a live feed wants.
 */
export function Reveal({
  children,
  delay = 0,
  animation = 'rise',
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  /** Milliseconds. Usually `index * 60` inside a list. */
  delay?: number;
  animation?: 'rise' | 'fade-in' | 'pop';
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article' | 'span';
}) {
  const animations = {
    rise: 'animate-rise',
    'fade-in': 'animate-fade-in',
    pop: 'animate-pop',
  };

  const style: CSSProperties | undefined =
    delay > 0 ? { animationDelay: `${delay}ms` } : undefined;

  return (
    <Tag className={cx(animations[animation], className)} style={style}>
      {children}
    </Tag>
  );
}

/**
 * A dot that says "this is polling".
 *
 * Live lists have a credibility problem: an empty feed looks identical whether it is
 * up to date or frozen. A visible heartbeat is the cheapest way to answer "is this
 * still working", and it stops a driver reloading a page that was already current.
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx('relative grid size-2 place-items-center', className)} aria-hidden="true">
      <span className="bg-brand-500 animate-halo absolute size-2 rounded-full" />
      <span className="bg-brand-500 animate-breathe size-2 rounded-full" />
    </span>
  );
}

/** Initials, because this app has no avatar uploads and inventing one would lie. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const sizes = {
    sm: 'size-7 text-[11px]',
    md: 'size-9 text-xs',
    lg: 'size-16 text-xl',
  };

  return (
    <span
      className={cx(
        'from-brand-500 to-brand-700 grid shrink-0 place-items-center rounded-full',
        'bg-gradient-to-br font-semibold text-white select-none',
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  );
}

/** Section label. `live` marks a list that polls, paired with {@link LiveDot}. */
export function SectionHeading({
  children,
  live = false,
  aside,
}: {
  children: ReactNode;
  live?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-neutral-500 uppercase">
        {children}
        {live && <LiveDot />}
      </h2>
      {aside}
    </div>
  );
}

/** A labelled figure, for rows where the number is the point. */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold text-neutral-900">{value}</p>
      {sub && <p className="tabular text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

/**
 * Explicit empty state. An empty list that renders as nothing is indistinguishable
 * from a broken one, which is the most common way a UI lies to its user.
 */
export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="animate-fade-in rounded-xl border border-dashed border-neutral-300 bg-white/50 px-6 py-10 text-center">
      {icon && <div className="mb-3 flex justify-center text-neutral-400">{icon}</div>}
      <p className="text-sm font-medium text-neutral-800">{title}</p>
      {children && <p className="mt-1 text-sm text-neutral-500">{children}</p>}
    </div>
  );
}

/** Shown while data loads, so the layout does not jump when it arrives. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-xl bg-neutral-200/70"
          // Offset so the placeholders pulse as a wave rather than in unison, which
          // reads as loading rather than as one broken flashing block.
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
