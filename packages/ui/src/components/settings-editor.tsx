import { Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../cn.ts';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { SettingControl, type SettingKind } from './setting-control.tsx';
import { Switch } from './switch.tsx';

export interface SettingItem {
  key: string;
  label: string;
  description: string;
  group: string;
  kind: SettingKind;
  options?: string[];
  min?: number;
  max?: number;
  /** What applies today. */
  value: unknown;
  /** What applies if the override is removed (the built-in or inherited value). */
  fallback: unknown;
  /** Has its own value, rather than following the level above. */
  overridden: boolean;
  /** Locked by the level above: shown, but cannot be changed here. */
  locked: boolean;
  /** The viewer may look but not change (no permission). */
  readOnly?: boolean;
  /** Platform view only: whether the lock switch is offered. */
  lockable?: boolean;
  /** Platform view only: the current lock, editable. */
  lockedByPlatform?: boolean;
}

export interface SettingChange {
  key: string;
  /** New value, or undefined to leave the value alone. */
  value?: unknown;
  /** Remove the override and go back to the fallback. */
  clear?: boolean;
  /** Platform view: set or remove the lock. */
  locked?: boolean;
}

interface Draft {
  value?: unknown;
  clear?: boolean;
  locked?: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings grouped in tabs with an unsaved-changes bar. Used by the super admin (platform
 * defaults, with a lock switch per setting) and by a company (its own overrides, with locked
 * settings shown read-only). Nothing is sent until Save.
 */
export function SettingsEditor({
  items,
  mode,
  onSave,
}: {
  items: SettingItem[];
  mode: 'platform' | 'tenant';
  onSave: (changes: SettingChange[]) => Promise<void>;
}) {
  const groups = useMemo(() => [...new Set(items.map((i) => i.group))], [items]);
  const [tab, setTab] = useState(groups[0] ?? '');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);

  const active = groups.includes(tab) ? tab : (groups[0] ?? '');
  const set = (key: string, patch: Draft) =>
    setDrafts((d) => {
      const next = { ...d, [key]: { ...d[key], ...patch } };
      const item = items.find((i) => i.key === key);
      const cur = next[key]!;
      // Drop a draft that puts everything back as it was.
      if (
        item &&
        (cur.value === undefined || same(cur.value, item.value)) &&
        !cur.clear &&
        (cur.locked === undefined || cur.locked === item.lockedByPlatform)
      )
        delete next[key];
      return next;
    });

  const changes = Object.keys(drafts).length;
  const save = async () => {
    setBusy(true);
    try {
      await onSave(
        Object.entries(drafts).map(([key, d]) => ({
          key,
          value: d.clear ? undefined : d.value,
          clear: d.clear,
          locked: d.locked,
        })),
      );
      setDrafts({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={g === active}
            onClick={() => setTab(g)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium',
              g === active
                ? 'border-accent text-accent-hi'
                : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="rounded-card border border-line bg-surface px-6 shadow-card">
        {items
          .filter((i) => i.group === active)
          .map((i) => {
            const d = drafts[i.key];
            const value = d?.clear ? i.fallback : d && 'value' in d ? d.value : i.value;
            const modified = d?.clear ? false : i.overridden || d?.value !== undefined;
            const lockedNow = d?.locked ?? i.lockedByPlatform ?? false;
            const lockedByPlatform = mode === 'tenant' && i.locked;
            const readOnly = lockedByPlatform || !!i.readOnly;
            return (
              <div
                key={i.key}
                className="grid items-center gap-x-6 gap-y-3 border-b border-line py-4 last:border-0 md:grid-cols-[1fr_minmax(160px,240px)_270px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.label}</span>
                    {modified && <Badge tone="accent">Changed</Badge>}
                    {lockedByPlatform && (
                      <Badge>
                        <Lock size={11} className="mr-1 inline" />
                        Set by the platform
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{i.description}</p>
                </div>
                <SettingControl
                  kind={i.kind}
                  value={value}
                  label={i.label}
                  options={i.options}
                  min={i.min}
                  max={i.max}
                  disabled={readOnly}
                  onChange={(v) => set(i.key, { value: v, clear: false })}
                />
                <div className="flex items-center justify-end gap-4 text-xs text-muted">
                  {(i.overridden || d) && !readOnly && (
                    <button
                      type="button"
                      className="underline hover:text-fg"
                      onClick={() => set(i.key, { clear: true, value: undefined })}
                      aria-label={`Reset ${i.label}`}
                    >
                      Reset
                    </button>
                  )}
                  {mode === 'platform' && i.lockable && (
                    <label className="flex items-center gap-2 whitespace-nowrap">
                      <Switch
                        checked={lockedNow}
                        onChange={(next) => set(i.key, { locked: next })}
                        label={`Lock ${i.label} for companies`}
                      />
                      {lockedNow ? 'Locked' : 'Companies can change'}
                    </label>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {changes > 0 && (
        <div className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-3 rounded-card border border-accent bg-surface-raised px-5 py-3 shadow-card">
          <Badge tone="accent">
            {changes} unsaved {changes === 1 ? 'change' : 'changes'}
          </Badge>
          <span className="flex-1" />
          <Button variant="secondary" onClick={() => setDrafts({})} disabled={busy}>
            Discard
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
