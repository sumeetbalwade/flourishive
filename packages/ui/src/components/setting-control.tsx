import { Input } from './input.tsx';
import { Select } from './select.tsx';
import { Switch } from './switch.tsx';

export type SettingKind = 'boolean' | 'number' | 'enum' | 'color' | 'text';

const nice = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();

/** Draws the right input for a setting from its kind (switch, number, choice, colour or text). */
export function SettingControl({
  kind,
  value,
  onChange,
  label,
  options,
  min,
  max,
  disabled,
}: {
  kind: SettingKind;
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
  options?: string[];
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  if (kind === 'boolean')
    return (
      <Switch checked={value === true} onChange={onChange} label={label} disabled={disabled} />
    );
  if (kind === 'enum')
    return (
      <Select
        value={String(value)}
        onValueChange={onChange}
        options={(options ?? []).map((o) => ({ value: o, label: nice(o) }))}
        className={disabled ? 'pointer-events-none opacity-50' : undefined}
      />
    );
  if (kind === 'color')
    return (
      <input
        type="color"
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-16 cursor-pointer rounded-md border border-line-strong bg-transparent p-1 disabled:opacity-50"
      />
    );
  if (kind === 'number')
    return (
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  return (
    <Input
      aria-label={label}
      value={String(value ?? '')}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
