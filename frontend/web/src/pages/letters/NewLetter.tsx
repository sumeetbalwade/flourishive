import { Button, Card, DatePicker, EmptyState, Field, Input, Skeleton } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { fullName } from '../../lib/format.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { typeLabel } from './labels.ts';

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (v?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};

/** Pick a template and a person, fill in the details, and the server draws the letter on the company's stationery. */
export function NewLetter() {
  const api = useApi();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.documents.templates() });
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api.org.entities() });
  const [templateId, setTemplateId] = useState<string>();
  const [entityPick, setEntityPick] = useState<string>();
  const [search, setSearch] = useState('');
  const [engagementId, setEngagementId] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const template = templates.data?.find((t) => t.id === templateId);
  const fields = template?.versions[0]?.fields ?? [];
  const onlyEntity = entities.data?.length === 1 ? entities.data[0]!.id : undefined;
  const entityId = entityPick ?? onlyEntity;

  const people = useQuery({
    queryKey: ['people', 'pick', search],
    queryFn: () => api.people.list({ q: search || undefined, page: 1, pageSize: 8 }),
    enabled: search.trim().length >= 2,
  });
  const person = useMemo(
    () => people.data?.items.find((p) => p.id === engagementId),
    [people.data, engagementId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!template || !entityId) return setError('Choose a template and a company.');
    if (!person) return setError('Choose the person this letter is for.');
    const missing = fields.filter((f) => f.required && !(values[f.key] ?? '').trim());
    if (missing.length) return setError(`Fill in: ${missing.map((m) => m.label).join(', ')}.`);
    setBusy(true);
    setError('');
    try {
      const doc = await api.documents.generate({
        templateId: template.id,
        entityId,
        personId: person.personId,
        engagementId: person.id,
        fields: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())),
      });
      await qc.invalidateQueries({ queryKey: ['documents'] });
      go(`/app/letters/${doc.id}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <Layout active="letters" title="New letter">
      {templates.isPending ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : (templates.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No templates yet"
          description="A letter is made from a template. Create one first (it takes a minute)."
          action={<Button onClick={() => go('/app/templates')}>Go to templates</Button>}
        />
      ) : (
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          <Card className="grid gap-4 p-5">
            <Field label="Template" htmlFor="l-template">
              <SelectField
                id="l-template"
                value={templateId}
                allowNone={false}
                placeholder="Choose a template"
                onChange={(v) => {
                  setTemplateId(v);
                  setValues({});
                }}
                options={(templates.data ?? []).map((t) => ({
                  value: t.id,
                  label: `${t.name} · ${typeLabel(t.letterType)}`,
                }))}
              />
            </Field>
            {entities.data && entities.data.length > 1 ? (
              <Field label="Company" htmlFor="l-entity">
                <SelectField
                  id="l-entity"
                  value={entityPick}
                  allowNone={false}
                  placeholder="Choose a company"
                  onChange={setEntityPick}
                  options={entities.data.map((e) => ({ value: e.id, label: e.name }))}
                />
              </Field>
            ) : null}
            <Field
              label="Person"
              htmlFor="l-person"
              hint={person ? undefined : 'Type at least two letters of a name or employee code.'}
            >
              <Input
                id="l-person"
                autoComplete="off"
                placeholder="Search people"
                value={person ? fullName(person) : search}
                onChange={(e) => {
                  setEngagementId(undefined);
                  setSearch(e.target.value);
                }}
              />
            </Field>
            {!person && people.data?.items.length ? (
              <ul className="-mt-2 grid gap-1">
                {people.data.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEngagementId(p.id);
                        if (!entityPick) setEntityPick(p.entityId);
                      }}
                      className="w-full rounded-card px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      {fullName(p)}{' '}
                      <span className="text-muted">
                        · {p.employeeCode}
                        {p.designation ? ` · ${p.designation.name}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {template ? (
            <Card className="grid gap-4 p-5">
              <h2 className="font-display text-xl">Details for the letter</h2>
              {fields.length === 0 ? (
                <p className="text-sm text-muted">This template has nothing to fill in.</p>
              ) : null}
              {fields.map((f) => (
                <Field
                  key={f.key}
                  label={f.label + (f.required ? '' : ' (optional)')}
                  htmlFor={`f-${f.key}`}
                >
                  {f.type === 'date' ? (
                    <DatePicker
                      id={`f-${f.key}`}
                      value={toDate(values[f.key])}
                      onChange={(d) => setValues((s) => ({ ...s, [f.key]: d ? isoDay(d) : '' }))}
                    />
                  ) : f.type === 'longtext' ? (
                    <textarea
                      id={`f-${f.key}`}
                      rows={4}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="w-full rounded-card border border-line-strong bg-surface-2 p-4 text-sm focus-visible:border-accent"
                    />
                  ) : (
                    <Input
                      id={`f-${f.key}`}
                      inputMode={f.type === 'number' ? 'numeric' : undefined}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </Card>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy || !template}>
              {busy ? 'Creating…' : 'Create letter'}
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
