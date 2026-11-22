import { Badge, Button, Card, DatePicker, Field, Input, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { fullName } from '../../lib/format.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { parseCsv } from './csv.ts';
import { typeLabel } from './labels.ts';

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (v?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};

type Mode = 'people' | 'csv';

/** Issue one template to many people: pick them from the list or paste a CSV. */
export function BulkIssue() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.documents.templates() });
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api.org.entities() });
  const [templateId, setTemplateId] = useState<string>();
  const [entityPick, setEntityPick] = useState<string>();
  const [mode, setMode] = useState<Mode>('people');
  const [shared, setShared] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [csv, setCsv] = useState('');
  const [batchId, setBatchId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  const template = templates.data?.find((t) => t.id === templateId);
  const fields = template?.versions[0]?.fields ?? [];
  const onlyEntity = entities.data?.length === 1 ? entities.data[0]!.id : undefined;
  const entityId = entityPick ?? onlyEntity;
  // The person's name and dates come from their record; only the rest is asked for once.
  const sharedFields = fields.filter((f) => f.key !== 'recipientName');

  const people = useQuery({
    queryKey: ['people', 'bulk'],
    queryFn: () => api.people.list({ page: 1, pageSize: 100 }),
    enabled: mode === 'people',
  });

  const batch = useQuery({
    queryKey: ['bulk', batchId],
    queryFn: () => api.documents.bulk(batchId!),
    enabled: !!batchId,
    refetchInterval: (q) => (q.state.data?.finished ? false : 3000),
  });
  useEffect(() => {
    if (batch.data?.finished) void qc.invalidateQueries({ queryKey: ['documents'] });
  }, [batch.data?.finished, qc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!template || !entityId) return setError('Choose a template and a company.');
    setError('');
    setProblems([]);
    let rows: { personId?: string; engagementId?: string; fields: Record<string, string> }[];
    if (mode === 'people') {
      const chosen = (people.data?.items ?? []).filter((p) => picked.includes(p.id));
      if (!chosen.length) return setError('Tick at least one person.');
      rows = chosen.map((p) => ({ personId: p.personId, engagementId: p.id, fields: {} }));
    } else {
      const parsed = parseCsv(csv);
      if (!parsed.length) return setError('Paste a header line and at least one row.');
      rows = parsed.map((fields) => ({ fields }));
    }
    setBusy(true);
    try {
      const res = await api.documents.startBulk({
        templateId: template.id,
        entityId,
        shared: Object.fromEntries(Object.entries(shared).filter(([, v]) => v.trim())),
        rows,
      });
      setBatchId(res.id);
    } catch (err) {
      const body = (err as { body?: { errors?: string[] } }).body;
      setProblems(body?.errors ?? []);
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function emailAll() {
    if (!batchId) return;
    setBusy(true);
    try {
      const r = await api.documents.deliverBulk(batchId);
      toast({
        tone: r.sent === r.results.length ? 'success' : 'info',
        title: `Emailed ${r.sent} of ${r.results.length}`,
      });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const b = batch.data;
  return (
    <Layout active="letters" title="Issue in bulk">
      {b ? (
        <Card className="grid max-w-3xl gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">
              {b.finished ? 'Finished' : 'Issuing…'} · {b.done} of {b.total} done
              {b.failed ? `, ${b.failed} failed` : ''}
            </h2>
            {b.finished ? (
              <Badge tone={b.failed ? 'warning' : 'success'}>
                {b.failed ? 'Some failed' : 'All issued'}
              </Badge>
            ) : (
              <Badge tone="neutral">Working</Badge>
            )}
          </div>
          <ul className="grid gap-1 text-sm">
            {b.rows.map((r) => (
              <li
                key={r.position}
                className="flex flex-wrap justify-between gap-2 rounded-card px-3 py-2 hover:bg-surface-2"
              >
                <span>
                  {r.position}.{' '}
                  {r.documentId ? (
                    <button
                      type="button"
                      className="font-mono text-xs text-accent"
                      onClick={() => go(`/app/letters/${r.documentId}`)}
                    >
                      {r.reference}
                    </button>
                  ) : (
                    <span className="text-muted">
                      {r.status === 'PENDING' ? 'waiting' : 'not issued'}
                    </span>
                  )}
                </span>
                {r.error ? <span className="text-danger">{r.error}</span> : null}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            Letters start as drafts. Approve and sign them from the Letters list; once issued you
            can email the links here.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => go('/app/letters')}>
              Go to letters
            </Button>
            {b.finished ? (
              <Button loading={busy} disabled={busy} onClick={() => void emailAll()}>
                Email links to everyone issued
              </Button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </Card>
      ) : templates.isPending ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : (
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          <Card className="grid gap-4 p-5">
            <Field label="Template" htmlFor="b-template">
              <SelectField
                id="b-template"
                value={templateId}
                allowNone={false}
                placeholder="Choose a template"
                onChange={(v) => {
                  setTemplateId(v);
                  setShared({});
                }}
                options={(templates.data ?? []).map((t) => ({
                  value: t.id,
                  label: `${t.name} · ${typeLabel(t.letterType)}`,
                }))}
              />
            </Field>
            {entities.data && entities.data.length > 1 ? (
              <Field label="Company" htmlFor="b-entity">
                <SelectField
                  id="b-entity"
                  value={entityPick}
                  allowNone={false}
                  placeholder="Choose a company"
                  onChange={setEntityPick}
                  options={entities.data.map((e) => ({ value: e.id, label: e.name }))}
                />
              </Field>
            ) : null}
          </Card>

          {template ? (
            <Card className="grid gap-4 p-5">
              <h2 className="font-display text-xl">Same for everyone</h2>
              <p className="-mt-2 text-sm text-muted">
                Names and dates are taken from each person's record when you pick people. Anything
                you fill in here applies to all of them.
              </p>
              {sharedFields.map((f) => (
                <Field
                  key={f.key}
                  label={f.label + (f.required ? '' : ' (optional)')}
                  htmlFor={`s-${f.key}`}
                >
                  {f.type === 'date' ? (
                    <DatePicker
                      id={`s-${f.key}`}
                      value={toDate(shared[f.key])}
                      onChange={(d) => setShared((s) => ({ ...s, [f.key]: d ? isoDay(d) : '' }))}
                    />
                  ) : (
                    <Input
                      id={`s-${f.key}`}
                      value={shared[f.key] ?? ''}
                      onChange={(e) => setShared((s) => ({ ...s, [f.key]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </Card>
          ) : null}

          {template ? (
            <Card className="grid gap-4 p-5">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'people' ? 'primary' : 'secondary'}
                  onClick={() => setMode('people')}
                >
                  Pick people
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'csv' ? 'primary' : 'secondary'}
                  onClick={() => setMode('csv')}
                >
                  Paste CSV
                </Button>
              </div>
              {mode === 'people' ? (
                people.isPending ? (
                  <Skeleton className="h-24" />
                ) : (
                  <ul className="grid max-h-80 gap-1 overflow-auto">
                    {(people.data?.items ?? []).map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-card px-3 py-2 text-sm hover:bg-surface-2">
                          <input
                            type="checkbox"
                            checked={picked.includes(p.id)}
                            onChange={(e) =>
                              setPicked((s) =>
                                e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id),
                              )
                            }
                          />
                          {fullName(p)} <span className="text-muted">· {p.employeeCode}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <Field
                  label="CSV"
                  htmlFor="b-csv"
                  hint={`First line = column names, for example: ${['recipientName', ...sharedFields.slice(0, 2).map((f) => f.key)].join(',')}`}
                >
                  <textarea
                    id="b-csv"
                    rows={8}
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    className="w-full rounded-card border border-line-strong bg-surface-2 p-4 font-mono text-xs focus-visible:border-accent"
                  />
                </Field>
              )}
            </Card>
          ) : null}

          {error ? (
            <div role="alert" className="grid gap-1 text-sm text-danger">
              <p>{error}</p>
              {problems.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" loading={busy} disabled={busy || !template}>
              Create the letters
            </Button>
            <Button type="button" variant="ghost" onClick={() => go('/app/letters')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Layout>
  );
}
