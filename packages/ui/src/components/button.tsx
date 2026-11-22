import { cva, type VariantProps } from 'class-variance-authority';
import { useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { cn } from '../cn.ts';

export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-pill font-medium',
    'transition-[transform,background-color,color,box-shadow,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
    'active:scale-[0.97] active:duration-75',
    'disabled:pointer-events-none disabled:opacity-50',
    'data-[loading]:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-on-accent shadow-[0_1px_0_rgb(255_255_255/0.25)_inset] hover:-translate-y-px hover:bg-accent-hi hover:shadow-press active:translate-y-0',
        secondary:
          'border border-line-strong bg-surface text-fg shadow-card hover:-translate-y-px hover:border-accent hover:text-accent-hi active:translate-y-0',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
        danger:
          'bg-danger-lo text-danger hover:-translate-y-px hover:bg-danger hover:text-white active:translate-y-0',
        deep: 'bg-deep text-on-deep hover:-translate-y-px hover:bg-deep-hi active:translate-y-0',
      },
      size: {
        sm: 'h-8 px-3.5 text-[13px]',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-7 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Show the loading state. Left out, a click handler that returns a promise sets it by itself. */
    loading?: boolean;
  };

type Ripple = { id: number; x: number; y: number; size: number };
let rippleId = 0;

/** A small arc that turns, drawn in the button's own text colour. */
function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 animate-spin [animation-duration:700ms]"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  loading,
  children,
  disabled,
  onClick,
  onPointerDown,
  ...props
}: ButtonProps) {
  const [pending, setPending] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const busy = loading ?? pending;

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    const result: unknown = onClick?.(e);
    if (loading === undefined && result instanceof Promise) {
      setPending(true);
      void result.then(
        () => setPending(false),
        () => setPending(false),
      );
    }
  }

  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      data-loading={busy ? '' : undefined}
      disabled={disabled}
      className={cn(buttonVariants({ variant, size }), className)}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        const r = e.currentTarget.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 2.2;
        setRipples((rs) => [
          ...rs.slice(-3),
          {
            id: ++rippleId,
            x: e.clientX - r.left - size / 2,
            y: e.clientY - r.top - size / 2,
            size,
          },
        ]);
      }}
      onClick={handleClick}
      {...props}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          onAnimationEnd={() => setRipples((rs) => rs.filter((x) => x.id !== r.id))}
          className="pointer-events-none absolute animate-ripple rounded-full bg-current"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
        />
      ))}
      {busy && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />
      )}
      {busy && <Spinner />}
      <span className={cn('relative inline-flex items-center gap-2', busy && 'opacity-80')}>
        {children}
      </span>
    </button>
  );
}
