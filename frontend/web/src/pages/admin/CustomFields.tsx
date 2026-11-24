import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldEntity,
  type CustomFieldType,
  type CustomFieldView,
} from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Segmented,
  Skeleton,
  Switch,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

interface Draft {
  id?: string;
  entityType: CustomFieldEntity;
  label: string;
  helpText: string;
  type: CustomFieldType;
  options: string;
  required: boolean;
  /** Empty: everyone who can see the record. */
  visibleToRoles: string[];
  editableByRoles: string[];
}

const blank = (entityType: CustomFieldEntity): Draft => ({
  entityType,
  label: '',
  helpText: '',
  type: 'TEXT',
  options: '',
  required: false,
  visibleToRoles: [],
  editableByRoles: [],
});

const fromView = (f: CustomFieldView): Draft => ({
  id: f.id,
  entityType: f.entityType,
  label: f.label,
  helpText: f.helpText,
  type: f.type,
  options: f.options.join('\n'),
  required: f.required,
  visibleToRoles: f.visibleToRoles ?? [],
  editableByRoles: f.editableByRoles ?? [],
});

function RolePicker({
  legend,
  roles,
  value,
  onChange,
}: {
  legend: string;
  roles: { key: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted">
        {value.length === 0
          ? 'Everyone who can use the record. Tick roles to limit it. Tenant admins always can.'
          : 'Only the ticked roles, and tenant admins.'}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {roles.map((r) => (
          <label key={r.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(r.key)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, r.key] : value.filter((k) => k !== r.key))
              }
            />
            {r.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The fields this company adds to people and engagements, and who may see and change them (D-29). */
export function CustomFields() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const defs = useQuery({
    queryKey: ['custom-defs'],
    queryFn: () => api.customFields.definitions(),
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.access.roles() });
  const [kind, setKind] = useState<CustomFieldEntity>('PERSON');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['custom-defs'] });
  const shown = (defs.data ?? []).filter((d) => d.entityType === kind);
  const roleName = (k: string) => roles.data?.find((r) => r.key === k)?.name ?? k;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        entityType: draft.entityType,
        label: draft.label,
        helpText: draft.helpText,
        type: draft.type,
        options: draft.options
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean),
        required: draft.required,
        visibleToRoles: draft.visibleToRoles.length ? draft.visibleToRoles : null,
        editableByRoles: draft.editableByRoles.length ? draft.editableByRoles : null,
        sortOrder: 0,
      };
      if (draft.id) await api.customFields.update(draft.id, body);
      else await api.customFields.create(body);
      await refresh();
      setDraft(null);
      toast({ title: 'Field saved', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(f: CustomFieldView) {
    try {
      await (f.archived ? api.customFields.restore(f.id) : api.customFields.archive(f.id));
      await refresh();
    } catch (e) {
      toast({ title: messageOf(e), tone: 'danger' });
    }
  }

  const roleOptions = (roles.data ?? []).map((r) => ({ key: r.key, name: r.name }));

  return (
    <Layout
      active="custom-fields"
      title="Custom fields"
      actions={
        <Button size="sm" onClick={() => (setError(''), setDraft(blank(kind)))}>
          Add a field
        </Button>
      }
    >
      <div className="grid gap-4">
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as CustomFieldEntity)}
          options={[
            { value: 'PERSON', label: 'About the person' },
            { value: 'ENGAGEMENT', label: 'About the engagement' },
          ]}
          label="Kind of record"
        />
        {draft ? (
          <Card>
            <CardTitle>{draft.id ? 'Edit field' : 'New field'}</CardTitle>
            <form
              className="mt-4 grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Field label="Name" htmlFor="cf-label">
                <Input
                  id="cf-label"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </Field>
              <Field
                label="Type"
                htmlFor="cf-type"
                hint={draft.id ? 'The type cannot change after creating the field' : undefined}
              >
                <select
                  id="cf-type"
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm"
                  disabled={Boolean(draft.id)}
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomFieldType })}
                >
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              {draft.type === 'SELECT' ? (
                <div className="sm:col-span-2">
                  <Field label="Choices" htmlFor="cf-options" hint="One per line">
                    <textarea
                      id="cf-options"
                      rows={4}
                      className="w-full rounded-lg border border-line bg-surface p-3 text-sm"
                      value={draft.options}
                      onChange={(e) => setDraft({ ...draft, options: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <Field label="Help text" htmlFor="cf-help" hint="Optional, shown under the field">
                  <Input
                    id="cf-help"
                    value={draft.helpText}
                    onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={draft.required}
                  onChange={(v) => setDraft({ ...draft, required: v })}
                  label="Required"
                />
                Cannot be cleared once filled in
              </label>
              <RolePicker
                legend="Who can see it"
                roles={roleOptions}
                value={draft.visibleToRoles}
                onChange={(v) => setDraft({ ...draft, visibleToRoles: v })}
              />
              <RolePicker
                legend="Who can change it"
                roles={roleOptions}
                value={draft.editableByRoles}
                onChange={(v) => setDraft({ ...draft, editableByRoles: v })}
              />
              {error ? (
                <p role="alert" className="text-sm text-danger sm:col-span-2">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" loading={busy} disabled={!draft.label.trim()}>
                  Save field
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
        {defs.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No custom fields yet"
            description="Add fields such as blood group, emergency contact or a signed policy file."
          />
        ) : (
          <ul className="grid gap-2">
            {shown.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.label}</span>
                    <Badge>{CUSTOM_FIELD_TYPES.find((t) => t.key === f.type)?.label}</Badge>
                    {f.required ? <Badge tone="info">Required</Badge> : null}
                    {f.archived ? <Badge tone="warning">Archived</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Seen by{' '}
                    {f.visibleToRoles ? f.visibleToRoles.map(roleName).join(', ') : 'everyone'} ·
                    changed by{' '}
                    {f.editableByRoles ? f.editableByRoles.map(roleName).join(', ') : 'everyone'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => (setError(''), setDraft(fromView(f)))}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleArchive(f)}>
                    {f.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
