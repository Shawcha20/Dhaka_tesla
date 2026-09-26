import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Tiny class joiner. A dependency for this would be silly. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  full?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'bg-white text-neutral-800 ring-1 ring-neutral-300 hover:bg-neutral-50 disabled:text-neutral-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/50',
  ghost: 'text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400',
};

export function Button({
  variant = 'primary',
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
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed',
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
        <p role="alert" className="text-sm text-rose-700">
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
        'placeholder:text-neutral-400 disabled:bg-neutral-100 disabled:text-neutral-500',
        invalid ? 'ring-rose-400' : 'ring-neutral-300',
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
        'disabled:bg-neutral-100 disabled:text-neutral-500',
        invalid ? 'ring-rose-400' : 'ring-neutral-300',
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
      className={cx('rounded-lg px-3.5 py-3 text-sm ring-1 ring-inset', tones[tone])}
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
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
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
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  return (
    <Tag className={cx('rounded-xl bg-white p-4 ring-1 ring-neutral-200', className)}>
      {children}
    </Tag>
  );
}

/**
 * Explicit empty state. An empty list that renders as nothing is indistinguishable
 * from a broken one, which is the most common way a UI lies to its user.
 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center">
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
        <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-200/70" />
      ))}
    </div>
  );
}
