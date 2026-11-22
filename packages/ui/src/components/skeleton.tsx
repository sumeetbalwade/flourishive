import type { HTMLAttributes } from 'react';
import { cn } from '../cn.ts';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(100deg,var(--surface-2)_30%,var(--border)_50%,var(--surface-2)_70%)] bg-[length:200%_100%] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
