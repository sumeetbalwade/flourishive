import { Button, Card, Field, Input, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { TemplateEditor } from './TemplateEditor.tsx';

type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'date' | 'number' | 'amount';
  required: boolean;
};
const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'amount', label: 'Amount (Rs.)' },
];

/** Edit a visual-editor template. Saving adds a new version; letters already issued keep the old one. */
export function TemplateEdit({ id }: { id: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const tpl = useQuery({
    queryKey: ['template', id],
    queryFn: async () => (await api.documents.templates()).find((t) => t.id === id) ?? null,
  });
  const [doc, setDoc] = useState<string>();
  const [fields, setFields] = useState<FieldDef[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const v = tpl.data?.versions[0];
  const isEditor = !!v?.layoutKey?.startsWith('editor');
  const curDoc = doc ?? (v?.content as { doc?: string } | undefined)?.doc;
  const curFields = fields ?? (v?.fields as FieldDef[] | undefined);

  async function save() {
    if (!curDoc || !curFields) return;
    setBusy(true);
    setError('');
    try {
      await api.documents.addTemplateVersion(id, { content: { doc: curDoc }, fields: curFields });
      await qc.invalidateQueries({ queryKey: ['templates'] });
      await qc.invalidateQueries({ queryKey: ['template', id] });
      toast({ tone: 'success', title: 'Saved as a new version' });
      go('/app/templates');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<FieldDef>) =>
    setFields((curFields ?? []).map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <Layout active="templates" title={tpl.data ? tpl.data.name : 'Edit template'}>
      {tpl.isPending ? (
        <Skeleton className="h-64 w-full max-w-3xl" />
      ) : !tpl.data || !isEditor || !curDoc || !curFields ? (
        <p className="text-sm text-muted">
          This template is not a visual-editor template, so it has no editor.
        </p>
      ) : (
        <div className="grid max-w-3xl gap-5">
          <Card className="grid gap-3 p-5">
            <h2 className="font-display text-xl">Wording</h2>
            <p className="text-sm text-muted">
              Use Insert field to place details HR fills in for each letter. Type the field with the
              button so it is not split by formatting.
            </p>
            <TemplateEditor value={curDoc} onChange={setDoc} fields={curFields} />
          </Card>
          <Card className="grid gap-3 p-5">
            <h2 className="font-display text-xl">Details HR fills in</h2>
            {curFields.map((f, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
                <Field label="Name in text" htmlFor={`k-${i}`}>
                  <Input
                    id={`k-${i}`}
                    value={f.key}
                    onChange={(e) =>
                      update(i, { key: e.target.value.replace(/[^a-zA-Z0-9]/g, '') })
                    }
                  />
                </Field>
                <Field label="Label" htmlFor={`l-${i}`}>
                  <Input
                    id={`l-${i}`}
                    value={f.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </Field>
                <Field label="Kind" htmlFor={`t-${i}`}>
                  <SelectField
                    id={`t-${i}`}
                    value={f.type}
                    allowNone={false}
                    onChange={(t) => update(i, { type: t as FieldDef['type'] })}
                    options={TYPES}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFields(curFields.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setFields([...curFields, { key: '', label: '', type: 'text', required: true }])
              }
            >
              Add a detail
            </Button>
          </Card>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button loading={busy} disabled={busy} onClick={() => void save()}>
              Save as new version
            </Button>
            <Button variant="ghost" onClick={() => go('/app/templates')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
