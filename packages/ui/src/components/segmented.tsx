import { motion } from 'motion/react';
import { useId } from 'react';
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
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-pill border border-line bg-surface-2 p-1"
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
            'relative h-8 rounded-pill px-4 text-[13px] font-medium transition-colors duration-[var(--dur-fast)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'text-on-accent' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              aria-hidden="true"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              className="absolute inset-0 rounded-pill bg-accent shadow-press"
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
