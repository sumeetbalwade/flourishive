import { cn } from '../cn.ts';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** A small set of mutually exclusive choices shown side by side (Off / Optional / Required). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentOption<T>[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-pill border border-line bg-bg p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-pill px-3.5 text-[13px] font-medium transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
