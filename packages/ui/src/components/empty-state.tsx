import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid animate-rise place-items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-16 text-center">
      {icon ? (
        <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-lo text-accent ring-8 ring-accent-lo/50">
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-2xl font-medium text-fg">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
