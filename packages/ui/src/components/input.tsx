import type { ComponentProps } from 'react';
import { cn } from '../cn.ts';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-pill border border-line-strong bg-surface px-5 text-sm text-fg shadow-[0_1px_2px_rgb(17_32_27/0.04)] placeholder:text-faint',
        'transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-accent/60',
        'focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)]',
        'disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_4px_var(--danger-lo)]',
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
      <label htmlFor={htmlFor} className="pl-1 text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="animate-fade-in pl-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="pl-1 text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
