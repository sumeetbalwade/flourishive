import { Select } from '@flourishive/ui';

const NONE = '__none';

/** A Select that can be cleared: an empty value is sent as "no choice". */
export function SelectField({
  id,
  value,
  onChange,
  options,
  placeholder,
  noneLabel = 'None',
  allowNone = true,
}: {
  id: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  /** Text for the "no choice" option, e.g. "All types" on a filter. */
  noneLabel?: string;
  allowNone?: boolean;
}) {
  return (
    <Select
      id={id}
      value={value ?? (allowNone ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
      placeholder={placeholder}
      options={allowNone ? [{ value: NONE, label: noneLabel }, ...options] : options}
    />
  );
}
