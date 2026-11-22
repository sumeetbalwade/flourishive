import type { HTMLAttributes } from 'react';
import { cn } from '../cn.ts';

export function Card({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'deep' }) {
  return (
    <div
      className={cn(
        'rounded-card border p-6 transition-shadow duration-[var(--dur-base)]',
        tone === 'deep'
          ? 'border-transparent bg-deep text-on-deep shadow-pop'
          : 'border-line bg-surface shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-display text-lg font-medium text-fg', className)} {...props} />;
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
      <div className="font-display text-5xl font-light leading-none tracking-tight text-fg">
        {value}
      </div>
      <div className="mt-2 text-sm text-muted">{label}</div>
    </Card>
  );
}
