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
    <div className="grid place-items-center gap-3 rounded-card border border-dashed border-line-strong px-6 py-14 text-center">
      {icon ? (
        <div className="grid h-12 w-12 place-items-center rounded-pill bg-accent-lo text-accent">
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-2xl text-fg">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
