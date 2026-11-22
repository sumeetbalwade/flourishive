import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn.ts';

/** `compact` gives the dense row height used by HR lists. */
export function Table({
  className,
  compact,
  ...p
}: HTMLAttributes<HTMLTableElement> & { compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <table
        data-compact={compact ? '' : undefined}
        className={cn('w-full border-collapse text-sm', className)}
        {...p}
      />
    </div>
  );
}

export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;

export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-line transition-colors duration-[var(--dur-fast)] last:border-0 hover:bg-accent-lo/50',
        className,
      )}
      {...p}
    />
  );
}

export function TH({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'bg-surface-2/60 px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-faint first:rounded-tl-card last:rounded-tr-card',
        className,
      )}
      {...p}
    />
  );
}

export function TD({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-6 py-4 text-fg in-data-[compact]:py-2.5', className)} {...p} />;
}
