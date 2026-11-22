import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn.ts';

export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium',
    'transition-[transform,background-color,color,box-shadow,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
    'active:scale-[0.97] active:duration-75',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:pointer-events-none',
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
  VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({
  className,
  variant,
  size,
  type = 'button',
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
