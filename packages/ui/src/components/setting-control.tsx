import { ImagePlus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '../cn.ts';
import { Button } from './button.tsx';
import { Input } from './input.tsx';
import { Select } from './select.tsx';
import { fmtDateTime } from '../format.ts';
import { Switch } from './switch.tsx';

export type SettingKind =
  | 'boolean'
  | 'number'
  | 'enum'
  | 'color'
  | 'font'
  | 'image'
  | 'text'
  | 'longtext'
  | 'email'
  | 'url'
  | 'secret'
  | 'list'
  | 'timezone'
  | 'json';

const nice = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface SecretInfo {
  isSet: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

/** Draws the right input for a setting from its kind. */
export function SettingControl({
  kind,
  value,
  onChange,
  label,
  options,
  min,
  max,
  disabled,
  secret,
  onUpload,
  onRemove,
}: {
  kind: SettingKind;
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
  /** enum choices, or the font names for kind 'font'. */
  options?: string[];
  min?: number;
  max?: number;
  disabled?: boolean;
  /** kind 'secret': whether a value is stored (the value itself is never available). */
  secret?: SecretInfo;
  /** kind 'image': called with the chosen file; the caller uploads it and passes the URL back as `value`. */
  onUpload?: (file: File) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
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
  if (kind === 'font')
    return (
      <div className="grid gap-2">
        <Select
          value={String(value ?? '')}
          onValueChange={onChange}
          options={(options ?? []).map((o) => ({ value: o, label: o }))}
          className={disabled ? 'pointer-events-none opacity-50' : undefined}
        />
        <p
          className="pl-1 text-base text-muted"
          style={{ fontFamily: `"${String(value)}", sans-serif` }}
        >
          The quick brown fox jumps over the lazy dog
        </p>
      </div>
    );
  if (kind === 'color') return <ColorControl {...{ value, onChange, label, disabled }} />;
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
  if (kind === 'longtext')
    return (
      <textarea
        aria-label={label}
        rows={4}
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-card border border-line-strong bg-surface px-5 py-3 text-sm text-fg placeholder:text-faint hover:border-accent/60 focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)] disabled:opacity-50"
      />
    );
  if (kind === 'secret') return <SecretControl {...{ label, onChange, disabled, secret }} />;
  if (kind === 'list') return <ListControl {...{ value, onChange, label, disabled }} />;
  if (kind === 'timezone') return <TimezoneControl {...{ value, onChange, disabled }} />;
  if (kind === 'image') return <ImageControl {...{ value, label, disabled, onUpload, onRemove }} />;
  return (
    <Input
      aria-label={label}
      type={kind === 'email' ? 'email' : kind === 'url' ? 'url' : 'text'}
      value={String(value ?? '')}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ColorControl({
  value,
  onChange,
  label,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
  disabled?: boolean;
}) {
  const text = String(value ?? '');
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        aria-label={label}
        value={HEX.test(text) ? text : '#000000'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-16 cursor-pointer rounded-md border border-line-strong bg-transparent p-1 disabled:opacity-50"
      />
      <Input
        aria-label={`${label} (hex)`}
        value={text}
        disabled={disabled}
        aria-invalid={text !== '' && !HEX.test(text)}
        maxLength={7}
        onChange={(e) => onChange(e.target.value)}
        className="w-32 font-mono"
      />
    </div>
  );
}

/** A stored secret is never shown. The person can only replace it. */
function SecretControl({
  label,
  onChange,
  disabled,
  secret,
}: {
  label: string;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  secret?: SecretInfo;
}) {
  const [replacing, setReplacing] = useState(!secret?.isSet);
  if (!replacing)
    return (
      <div className="flex items-center gap-3">
        <span
          className="font-mono text-sm tracking-widest text-muted"
          aria-label={`${label} is set`}
        >
          ••••••••••
        </span>
        <span className="text-xs text-faint">
          {secret?.updatedAt ? `set ${fmtDateTime(secret.updatedAt)}` : 'set in the server file'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => setReplacing(true)}
        >
          Replace
        </Button>
      </div>
    );
  return (
    <Input
      aria-label={label}
      type="password"
      autoComplete="off"
      placeholder="Paste the new value"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ListControl({
  value,
  onChange,
  label,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
  disabled?: boolean;
}) {
  const items = Array.isArray(value) ? (value as string[]) : [];
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <span
            key={it}
            className="inline-flex items-center gap-1 rounded-pill bg-surface-2 py-1 pl-3 pr-1.5 text-sm"
          >
            {it}
            <button
              type="button"
              aria-label={`Remove ${it}`}
              disabled={disabled}
              onClick={() => onChange(items.filter((x) => x !== it))}
              className="grid h-5 w-5 place-items-center rounded-pill text-muted hover:bg-line hover:text-fg"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <Input
        aria-label={`Add to ${label}`}
        placeholder="Type and press Enter"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function TimezoneControl({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const all = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['Asia/Kolkata', 'UTC'];
    }
  }, []);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? all.filter((z) => z.toLowerCase().includes(f)) : all;
    const current = String(value ?? '');
    return current && !list.includes(current) ? [current, ...list] : list;
  }, [all, filter, value]);
  return (
    <div className="grid gap-2">
      <Input
        aria-label="Search time zones"
        placeholder="Search, for example Kolkata"
        value={filter}
        disabled={disabled}
        onChange={(e) => setFilter(e.target.value)}
      />
      <Select
        value={String(value ?? '')}
        onValueChange={onChange}
        options={shown.slice(0, 200).map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
        className={disabled ? 'pointer-events-none opacity-50' : undefined}
      />
    </div>
  );
}

function ImageControl({
  value,
  label,
  disabled,
  onUpload,
  onRemove,
}: {
  value: unknown;
  label: string;
  disabled?: boolean;
  onUpload?: (file: File) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const url = typeof value === 'string' && value ? value : null;
  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          'grid h-16 w-16 place-items-center overflow-hidden rounded-card border border-line-strong bg-surface-2',
        )}
      >
        {url ? (
          <img src={url} alt={`${label} preview`} className="h-full w-full object-contain" />
        ) : (
          <ImagePlus size={20} className="text-faint" />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        aria-label={label}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload?.(f);
          e.target.value = '';
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {url ? 'Replace' : 'Upload'}
      </Button>
      {url && onRemove ? (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void onRemove()}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}
