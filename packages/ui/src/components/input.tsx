import type { InputHTMLAttributes } from 'react';
import { cn } from '../cn.ts';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-pill border border-line-strong bg-surface-2 px-5 text-sm text-fg placeholder:text-faint',
        'transition-colors duration-[var(--dur-fast)] focus-visible:border-accent disabled:opacity-50',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
