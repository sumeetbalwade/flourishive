import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn.ts';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium',
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

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
