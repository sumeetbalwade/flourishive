import type { ConfigTestResult, RuntimeConfigEntry } from '@flourishive/schemas';
import {
  Badge,
  Button,
  CollapsibleSection,
  EmptyState,
  SearchBox,
  SettingControl,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { slugOf } from '../lib/integration-sections.ts';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

const SOURCE: Record<RuntimeConfigEntry['source'], string> = {
  console: 'Set here',
  environment: 'From the server file',
  default: 'Built-in',
  unset: 'Not set',
};

const isDirty = (e: RuntimeConfigEntry, draft: unknown) =>
  draft !== undefined && (e.kind === 'secret' ? draft !== '' : draft !== (e.value ?? ''));

function TestButton({ group }: { group: string }) {
  const api = useApi();
  const test = useMutation<ConfigTestResult>({ mutationFn: () => api.config.test(group) });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {test.data ? (
        <p role="status" className={test.data.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
          {test.data.message}
        </p>
      ) : null}
      {test.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(test.error)}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        loading={test.isPending}
        disabled={test.isPending}
        onClick={() => test.mutate()}
      >
        Test
      </Button>
    </div>
  );
}

function Row({
  entry,
  draft,
  nonce,
  onDraft,
  onReset,
}: {
  entry: RuntimeConfigEntry;
  draft: unknown;
  nonce: number;
  onDraft: (v: unknown) => void;
  onReset: () => Promise<void>;
}) {
  const shown = draft !== undefined ? draft : entry.kind === 'secret' ? '' : (entry.value ?? '');
  return (
    <div className="grid gap-2 border-t border-line py-4 first:border-t-0 md:grid-cols-[minmax(0,16rem)_1fr]">
      <div>
        <p className="text-sm font-medium">{entry.label}</p>
        <p className="mt-0.5 text-xs text-faint">{entry.hint}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={entry.source === 'console' ? 'success' : 'neutral'}>
            {SOURCE[entry.source]}
          </Badge>
          {entry.restartRequired ? <Badge tone="neutral">Needs a restart</Badge> : null}
          {isDirty(entry, draft) ? <Badge tone="warning">Changed</Badge> : null}
        </div>
      </div>
      <div className="grid content-start gap-2">
        <SettingControl
          key={`${entry.key}:${nonce}`}
          kind={entry.kind}
          label={entry.label}
          value={shown}
          onChange={onDraft}
          secret={{ isSet: entry.isSet, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy }}
        />
        {entry.source === 'console' ? (
          <div>
            <Button size="sm" variant="ghost" onClick={onReset}>
              Use server file value
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Keys, mail server and addresses that used to need a server-file edit. Secrets are write-only. */
export function Integrations({ section }: { section?: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['platform-config'], queryFn: () => api.config.list() });
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-config'] });

  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [nonce, setNonce] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [force, setForce] = useState<{ open?: boolean; token: number }>({ token: 0 });
  const search = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => list.data ?? [], [list.data]);
  const byGroup = useMemo(() => {
    const m = new Map<string, RuntimeConfigEntry[]>();
    for (const e of entries) m.set(e.group, [...(m.get(e.group) ?? []), e]);
    return m;
  }, [entries]);

  // Search matches a section's name, or an item's name, hint or key. A matching section shows
  // everything in it; otherwise only the matching items.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return [...byGroup].flatMap(([group, items]) => {
      if (!q) return [{ group, items }];
      if (group.toLowerCase().includes(q)) return [{ group, items }];
      const hit = items.filter((e) =>
        [e.label, e.hint, e.key].some((t) => t.toLowerCase().includes(q)),
      );
      return hit.length ? [{ group, items: hit }] : [];
    });
  }, [byGroup, q]);
  const itemCount = visible.reduce((n, v) => n + v.items.length, 0);

  const dirtyKeys = (group: string) =>
    (byGroup.get(group) ?? []).filter((e) => isDirty(e, drafts[e.key])).map((e) => e.key);
  const anyDirty = [...byGroup.keys()].some((g) => dirtyKeys(g).length > 0);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // "/" jumps to the search box.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/input|textarea|select/i.test(t.tagName)) {
        e.preventDefault();
        search.current?.querySelector('input')?.focus();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  // A menu sub-item opens its section and scrolls to it.
  useEffect(() => {
    if (!section || !list.data) return;
    setQuery('');
    setForce((f) => ({ open: undefined, token: f.token + 1 }));
    const id = `section-${section}`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      ),
    );
  }, [section, list.data]);

  async function saveSection(group: string) {
    const keys = dirtyKeys(group);
    setSaving(group);
    const done: string[] = [];
    try {
      for (const key of keys) {
        await api.config.set(key, drafts[key] as string | number | boolean);
        done.push(key);
      }
      toast({ title: `${group} saved`, tone: 'success' });
    } catch (e) {
      const failed = keys[done.length];
      const label = entries.find((x) => x.key === failed)?.label ?? failed;
      toast({
        title: `${label} was not saved: ${messageOf(e)}`,
        description: done.length
          ? `${done.length} earlier change(s) in ${group} were saved.`
          : undefined,
        tone: 'danger',
      });
    } finally {
      setDrafts((d) => {
        const next = { ...d };
        for (const k of done) delete next[k];
        return next;
      });
      setNonce((n) => ({ ...n, ...Object.fromEntries(done.map((k) => [k, (n[k] ?? 0) + 1])) }));
      setSaving(null);
      await refresh();
    }
  }

  function discard(group: string) {
    const keys = (byGroup.get(group) ?? []).map((e) => e.key);
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
    setNonce((n) => ({ ...n, ...Object.fromEntries(keys.map((k) => [k, (n[k] ?? 0) + 1])) }));
  }

  async function reset(key: string, label: string) {
    try {
      await api.config.clear(key);
      toast({ title: `${label} goes back to the server file`, tone: 'success' });
      await refresh();
    } catch (e) {
      toast({ title: messageOf(e), tone: 'danger' });
    }
  }

  return (
    <Layout active={section ? `integrations/${section}` : 'integrations'} title="Integrations">
      {list.isPending ? (
        <div className="grid max-w-3xl gap-4">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : list.isError ? (
        <EmptyState title="Could not load the settings" description={messageOf(list.error)} />
      ) : (
        <div className="grid max-w-3xl gap-4">
          <p className="text-sm text-muted">
            Each section saves on its own. Changing a key or password asks you to confirm it is you.
            Saved secrets are never shown again. A value set here wins over the server file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div ref={search} className="min-w-60 flex-1">
              <SearchBox
                value={query}
                onChange={setQuery}
                label="Search integrations"
                placeholder="Search sections and settings   ( / )"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForce((f) => ({ open: true, token: f.token + 1 }))}
            >
              Expand all
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForce((f) => ({ open: false, token: f.token + 1 }))}
            >
              Collapse all
            </Button>
          </div>
          {q ? (
            <p role="status" className="pl-1 text-xs text-muted">
              {itemCount === 0
                ? 'No matches'
                : `${itemCount} ${itemCount === 1 ? 'setting' : 'settings'} in ${visible.length} ${visible.length === 1 ? 'section' : 'sections'}`}
            </p>
          ) : null}
          {visible.length === 0 ? (
            <EmptyState
              title={`Nothing matches “${query.trim()}”`}
              description="Try a section name such as Email, or a setting such as password or zone."
              action={
                <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            visible.map(({ group, items }) => {
              const all = byGroup.get(group) ?? [];
              const set = all.filter((e) => e.isSet).length;
              const id = slugOf(group);
              return (
                <CollapsibleSection
                  key={group}
                  id={id}
                  title={group}
                  summary={`${set} of ${all.length} set`}
                  defaultOpen={group === 'Email'}
                  open={q || id === section ? true : force.open}
                  forceToken={force.token}
                  dirtyCount={dirtyKeys(group).length}
                  saving={saving === group}
                  onSave={() => saveSection(group)}
                  onDiscard={() => discard(group)}
                  actions={<TestButton group={group} />}
                >
                  {items.map((e) => (
                    <Row
                      key={e.key}
                      entry={e}
                      draft={drafts[e.key]}
                      nonce={nonce[e.key] ?? 0}
                      onDraft={(v) => setDrafts((d) => ({ ...d, [e.key]: v }))}
                      onReset={() => reset(e.key, e.label)}
                    />
                  ))}
                </CollapsibleSection>
              );
            })
          )}
        </div>
      )}
    </Layout>
  );
}
