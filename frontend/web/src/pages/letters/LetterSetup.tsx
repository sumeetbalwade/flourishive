import { LETTER_TYPES } from '@flourishive/schemas';
import { Badge, Button, Card, CardTitle, Field, Input, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';
import { typeLabel } from './labels.ts';

/** The company's letterhead and how reference numbers look. Each upload is a new version; older letters keep theirs. */
export function LetterSetup() {
  const api = useApi();
  const auth = useAuth();
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api.org.entities() });
  const heads = useQuery({ queryKey: ['letterheads'], queryFn: () => api.documents.letterheads() });
  const numbering = useQuery({ queryKey: ['numbering'], queryFn: () => api.documents.numbering() });
  const canManage = auth.can('documents.manage');
  const name = (id: string) => entities.data?.find((e) => e.id === id)?.name ?? id;

  return (
    <Layout active="letter-setup" title="Letter setup">
      <div className="grid max-w-3xl gap-6">
        <Card className="grid gap-4 p-5">
          <CardTitle>Letterhead</CardTitle>
          <p className="text-sm text-muted">
            The company stationery every letter is printed on. Upload a PDF, PNG or JPG sized for
            A4.
          </p>
          {(heads.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No letterhead uploaded yet.</p>
          ) : (
            <ul className="grid gap-2">
              {heads.data!.map((h) => (
                <li key={h.id} className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{h.name}</span>
                  <span className="text-muted">{name(h.entityId)}</span>
                  <Badge>{h.orientation.toLowerCase()}</Badge>
                  <Badge tone="accent">version {h.version}</Badge>
                </li>
              ))}
            </ul>
          )}
          {canManage ? <UploadLetterhead entities={entities.data ?? []} /> : null}
        </Card>

        <Card className="grid gap-4 p-5">
          <CardTitle>Reference numbers</CardTitle>
          <p className="text-sm text-muted">
            Each letter gets a number like FS/OFR/2026/0001. Use {'{YYYY}'}, {'{YY}'} and{' '}
            {'{SEQ:4}'}.
          </p>
          {(numbering.data ?? []).map((n) => (
            <div key={n.id} className="text-sm">
              <span className="font-medium">{typeLabel(n.letterType)}</span>{' '}
              <span className="text-muted">{name(n.entityId)}</span>{' '}
              <span className="font-mono text-xs">{n.format}</span>
            </div>
          ))}
          {canManage ? <SetNumbering entities={entities.data ?? []} /> : null}
        </Card>
      </div>
    </Layout>
  );
}

type Entity = { id: string; name: string };

function UploadLetterhead({ entities }: { entities: Entity[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [entityPick, setEntity] = useState<string>();
  const [title, setTitle] = useState('Letterhead');
  const [orientation, setOrientation] = useState<'PORTRAIT' | 'LANDSCAPE'>('PORTRAIT');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entityId = entityPick ?? (entities.length === 1 ? entities[0]!.id : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId || !file) return setError('Choose the company and a file.');
    setBusy(true);
    setError('');
    try {
      await api.documents.uploadLetterhead(file, { entityId, name: title.trim(), orientation });
      await qc.invalidateQueries({ queryKey: ['letterheads'] });
      setFile(null);
      toast({ tone: 'success', title: 'Letterhead uploaded' });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 border-t border-line pt-4">
      {entities.length > 1 ? (
        <Field label="Company" htmlFor="lh-entity">
          <SelectField
            id="lh-entity"
            value={entityPick}
            allowNone={false}
            placeholder="Choose a company"
            onChange={setEntity}
            options={entities.map((e) => ({ value: e.id, label: e.name }))}
          />
        </Field>
      ) : null}
      <Field label="Name" htmlFor="lh-name">
        <Input id="lh-name" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Page shape" htmlFor="lh-orient">
        <SelectField
          id="lh-orient"
          value={orientation}
          allowNone={false}
          onChange={(v) => setOrientation(v === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT')}
          options={[
            { value: 'PORTRAIT', label: 'Portrait (letters)' },
            { value: 'LANDSCAPE', label: 'Landscape (certificates)' },
          ]}
        />
      </Field>
      <Field label="File" htmlFor="lh-file">
        <input
          id="lh-file"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="justify-self-start" loading={busy} disabled={busy}>
        {busy ? 'Uploading…' : 'Upload letterhead'}
      </Button>
    </form>
  );
}

function SetNumbering({ entities }: { entities: Entity[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [entityPick, setEntity] = useState<string>();
  const [letterType, setLetterType] = useState<string>('OFFER');
  const [format, setFormat] = useState('FS/OFR/{YYYY}/{SEQ:4}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entityId = entityPick ?? (entities.length === 1 ? entities[0]!.id : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId) return setError('Choose the company.');
    setBusy(true);
    setError('');
    try {
      await api.documents.saveNumbering({ entityId, letterType, format: format.trim() });
      await qc.invalidateQueries({ queryKey: ['numbering'] });
      toast({ tone: 'success', title: 'Numbering saved' });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 border-t border-line pt-4">
      {entities.length > 1 ? (
        <Field label="Company" htmlFor="nm-entity">
          <SelectField
            id="nm-entity"
            value={entityPick}
            allowNone={false}
            placeholder="Choose a company"
            onChange={setEntity}
            options={entities.map((e) => ({ value: e.id, label: e.name }))}
          />
        </Field>
      ) : null}
      <Field label="Kind of letter" htmlFor="nm-type">
        <SelectField
          id="nm-type"
          value={letterType}
          allowNone={false}
          onChange={(v) => setLetterType(v ?? 'OFFER')}
          options={LETTER_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
        />
      </Field>
      <Field label="Format" htmlFor="nm-format">
        <Input id="nm-format" value={format} onChange={(e) => setFormat(e.target.value)} />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="justify-self-start" loading={busy} disabled={busy}>
        {busy ? 'Saving…' : 'Save format'}
      </Button>
    </form>
  );
}
