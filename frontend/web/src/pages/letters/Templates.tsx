import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { LETTER_TYPES } from '@flourishive/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Plus } from 'lucide-react';
import { useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { typeLabel } from './labels.ts';

export function Templates() {
  const api = useApi();
  const auth = useAuth();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.documents.templates() });
  const [adding, setAdding] = useState(false);
  const canManage = auth.can('documents.manage');

  return (
    <Layout
      active="templates"
      title="Templates"
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={16} /> New template
          </Button>
        ) : undefined
      }
    >
      {list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(list.error)}
        </p>
      ) : list.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate size={22} />}
          title="No templates yet"
          description="A template sets the wording and the details HR fills in for each letter."
          action={
            canManage ? <Button onClick={() => setAdding(true)}>New template</Button> : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((t) => {
            const v = t.versions[0];
            return (
              <Card key={t.id} className="grid gap-2 p-5">
                <CardTitle>{t.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{typeLabel(t.letterType)}</Badge>
                  <span className="text-xs text-muted">version {v?.version}</span>
                </div>
                <p className="text-sm text-muted">
                  Asks for: {v?.fields.map((f) => f.label).join(', ') || 'nothing'}
                </p>
                {auth.can('documents.generate') ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2 justify-self-start"
                    onClick={() => go('/app/letters/new')}
                  >
                    Use this template
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent
          title="New template"
          description="Starts from a built-in layout and its standard wording."
        >
          <NewTemplate onDone={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function NewTemplate({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const layouts = useQuery({ queryKey: ['layouts'], queryFn: () => api.documents.layouts() });
  const [name, setName] = useState('');
  const [letterType, setLetterType] = useState<string>('OFFER');
  const [layoutKey, setLayoutKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !layoutKey) return setError('Give it a name and choose a layout.');
    setBusy(true);
    setError('');
    try {
      await api.documents.createTemplate({ name: name.trim(), letterType, layoutKey });
      await qc.invalidateQueries({ queryKey: ['templates'] });
      toast({ tone: 'success', title: 'Template created' });
      onDone();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-4">
      <Field label="Name" htmlFor="t-name">
        <Input
          id="t-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Offer letter"
        />
      </Field>
      <Field label="Kind of letter" htmlFor="t-type">
        <SelectField
          id="t-type"
          value={letterType}
          allowNone={false}
          onChange={(v) => setLetterType(v ?? 'OFFER')}
          options={LETTER_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
        />
      </Field>
      <Field label="Layout" htmlFor="t-layout">
        <SelectField
          id="t-layout"
          value={layoutKey}
          allowNone={false}
          placeholder="Choose a layout"
          onChange={setLayoutKey}
          options={(layouts.data ?? []).map((l) => ({
            value: l.key,
            label: `${l.label} (${l.orientation.toLowerCase()})`,
          }))}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create template'}
      </Button>
    </form>
  );
}
