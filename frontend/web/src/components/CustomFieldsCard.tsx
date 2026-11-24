import type { CustomFieldValuesView } from '@flourishive/schemas';
import { Button, Card, CardTitle, Input, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { brand } from '@flourishive/ui';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';

type Entry = CustomFieldValuesView[number];

function show(e: Entry): string {
  if (e.value === null || e.value === '') return '';
  if (e.field.type === 'DATE') return new Date(String(e.value)).toLocaleDateString();
  return String(e.value);
}

function FileValue({ id }: { id: string }) {
  const api = useApi();
  const f = useQuery({ queryKey: ['file', id], queryFn: () => api.files.get(id) });
  if (!f.data) return <span className="text-muted">…</span>;
  return (
    <a
      className="underline"
      href={`${brand.apiUrl}${f.data.downloadUrl ?? ''}`}
      target="_blank"
      rel="noreferrer"
    >
      {f.data.originalName}
    </a>
  );
}

/** The company's own fields for a person or an engagement, shown to those allowed and editable by those allowed. */
export function CustomFieldsCard({
  entityType,
  entityId,
  title,
  canWrite,
}: {
  entityType: 'PERSON' | 'ENGAGEMENT';
  entityId: string;
  title: string;
  canWrite: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['custom-values', entityType, entityId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.customFields.values(entityType, entityId),
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A card with nothing to show (no fields, or none visible to this person) stays out of the way.
  if (q.isPending) return <Skeleton className="h-24 w-full" />;
  if (q.isError || !q.data || q.data.length === 0) return null;
  const editable = canWrite && q.data.some((e) => e.field.canEdit);

  function start() {
    setError('');
    setDraft(
      Object.fromEntries(
        q.data!.map((e) => [e.field.key, e.value === null ? '' : String(e.value)]),
      ),
    );
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const changed: Record<string, string | number | null> = {};
      for (const e of q.data!) {
        if (!e.field.canEdit) continue;
        const next = draft[e.field.key] ?? '';
        const before = e.value === null ? '' : String(e.value);
        if (next !== before)
          changed[e.field.key] =
            next === '' ? null : e.field.type === 'NUMBER' ? Number(next) : next;
      }
      if (Object.keys(changed).length)
        qc.setQueryData(key, await api.customFields.saveValues(entityType, entityId, changed));
      setDraft(null);
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function upload(fieldKey: string, file: File) {
    setBusy(true);
    setError('');
    try {
      const f = await api.files.upload(file, file.name);
      setDraft((d) => ({ ...(d ?? {}), [fieldKey]: f.id }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {draft ? (
        <form
          className="mt-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {q.data.map((e) => {
            const id = `cf-${e.field.key}`;
            const value = draft[e.field.key] ?? '';
            return (
              <div key={e.field.id} className="grid gap-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {e.field.label}
                  {e.field.required ? ' *' : ''}
                </label>
                {!e.field.canEdit ? (
                  <span className="text-sm text-muted">{show(e) || '—'} (read only)</span>
                ) : e.field.type === 'SELECT' ? (
                  <select
                    id={id}
                    className="h-10 rounded-lg border border-line bg-surface px-3 text-sm"
                    value={value}
                    onChange={(ev) => setDraft({ ...draft, [e.field.key]: ev.target.value })}
                  >
                    <option value="">—</option>
                    {e.field.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : e.field.type === 'FILE' ? (
                  <div className="flex items-center gap-2 text-sm">
                    {value ? <FileValue id={value} /> : <span className="text-muted">No file</span>}
                    <input
                      id={id}
                      type="file"
                      className="text-xs"
                      onChange={(ev) => {
                        const f = ev.target.files?.[0];
                        if (f) void upload(e.field.key, f);
                      }}
                    />
                    {value && !e.field.required ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDraft({ ...draft, [e.field.key]: '' })}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <Input
                    id={id}
                    type={
                      e.field.type === 'NUMBER'
                        ? 'number'
                        : e.field.type === 'DATE'
                          ? 'date'
                          : 'text'
                    }
                    value={value}
                    onChange={(ev) => setDraft({ ...draft, [e.field.key]: ev.target.value })}
                  />
                )}
                {e.field.helpText ? (
                  <span className="text-xs text-muted">{e.field.helpText}</span>
                ) : null}
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="mt-3">
            {q.data.map((e) => (
              <div
                key={e.field.id}
                className="flex justify-between gap-6 border-b border-line py-2.5 text-sm last:border-0"
              >
                <dt className="text-muted">{e.field.label}</dt>
                <dd className="text-right">
                  {e.field.type === 'FILE' && e.value ? (
                    <FileValue id={String(e.value)} />
                  ) : (
                    show(e) || '—'
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {editable ? (
            <Button className="mt-3" size="sm" variant="secondary" onClick={start}>
              Edit
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
