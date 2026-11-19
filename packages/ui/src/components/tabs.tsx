import { Tabs as T } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../cn.ts';

export const Tabs = T.Root;

export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn('inline-flex gap-1 rounded-pill border border-line bg-surface p-1', className)}
      {...p}
    />
  );
}

export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'h-8 rounded-pill px-4 text-[13px] font-medium text-muted transition-colors duration-[var(--dur-fast)] hover:text-fg data-[state=active]:bg-accent-lo data-[state=active]:text-accent-hi',
        className,
      )}
      {...p}
    />
  );
}

export const TabsContent = T.Content;
