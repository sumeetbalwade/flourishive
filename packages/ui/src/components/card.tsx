import type { HTMLAttributes } from 'react';
import { cn } from '../cn.ts';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface p-6 shadow-card', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-fg', className)} {...props} />;
}

export function Stat({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="font-display text-5xl leading-none text-fg">{value}</div>
      <div className="mt-2 text-sm text-muted">{label}</div>
    </Card>
  );
}
