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
        'relative h-6 w-11 shrink-0 rounded-pill border transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-raised',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform duration-[var(--dur-fast)]',
          checked ? 'translate-x-5 bg-on-accent' : 'bg-muted',
        )}
      />
    </button>
  );
}
