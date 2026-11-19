import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn.ts';

/** `compact` gives the dense row height used by HR lists. */
export function Table({
  className,
  compact,
  ...p
}: HTMLAttributes<HTMLTableElement> & { compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
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
      className={cn('border-b border-line last:border-0 hover:bg-surface-2/60', className)}
      {...p}
    />
  );
}

export function TH({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-faint',
        className,
      )}
      {...p}
    />
  );
}

export function TD({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-5 py-4 text-fg in-data-[compact]:py-2', className)} {...p} />;
}
