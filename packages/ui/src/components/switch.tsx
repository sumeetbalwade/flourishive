import { motion } from 'motion/react';
import { cn } from '../cn.ts';

/** An on/off switch. `label` is read out by screen readers, since the switch has no visible text. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-pill border transition-colors duration-[var(--dur-base)] disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2',
      )}
    >
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ x: checked ? 20 : 0 }}
        whileTap={{ scaleX: 1.2 }}
        transition={{ type: 'spring', stiffness: 520, damping: 30 }}
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.25)]',
          checked ? 'bg-on-accent' : 'bg-faint',
        )}
      />
    </button>
  );
}
