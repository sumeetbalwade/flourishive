import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn.ts';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-muted',
        accent: 'bg-accent-lo text-accent-hi',
        success: 'bg-success-lo text-success',
        warning: 'bg-warning-lo text-warning',
        danger: 'bg-danger-lo text-danger',
        info: 'bg-info-lo text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/** A pill label. `dot` adds the status dot used in the design (Done, Waiting, Failed). */
export function Badge({
  className,
  tone,
  dot,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
