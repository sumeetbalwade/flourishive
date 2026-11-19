import type { ImportResult } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';

const SAMPLE = [
  'employee_code,first_name,last_name,type,start_date,work_email,department,designation,location,manager_code,college,course,graduation_year,entity',
  'E001,Asha,Patil,employee,01/04/2025,asha@company.com,Finance,Manager,Pune,,,,,',
  'I001,Karan,Mehta,intern,2026-06-01,karan@company.com,Finance,Intern,Pune,E001,COEP,B.Tech,2027,',
].join('\n');

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Three steps: choose a file, review a preview (nothing is saved yet), then confirm. */
export function ImportPeople() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(text: string, create: boolean) {
    setBusy(true);
    setError('');
    try {
      setPreview(await api.people.import(text, { dryRun: true, createMissing: create }));
    } catch (e) {
      setPreview(null);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(f: File | undefined) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024)
      return setError('That file is larger than 2 MB. Split it into smaller files.');
    const text = await f.text();
    setFile({ name: f.name, text });
    setDone(null);
    await check(text, createMissing);
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.people.import(file.text, { dryRun: false, createMissing });
      setDone(res);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ['people'] });
      toast({ title: 'Import finished', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const missing = preview
    ? [
        ...preview.willCreate.departments,
        ...preview.willCreate.designations,
        ...preview.willCreate.locations,
      ]
    : [];
  const total = preview ? preview.willCreate.people + preview.willUpdate.people : 0;

  return (
    <Layout active="import" title="Import people">
      <div className="grid max-w-4xl gap-5">
        <Card>
          <CardTitle>1. Choose your spreadsheet</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Save your sheet as CSV. Required columns:{' '}
            <code className="font-mono">
              employee_code, first_name, last_name, type, start_date
            </code>{' '}
            (type is employee or intern; dates as 2026-04-01 or 01/04/2026). Importing the same file
            again updates people instead of duplicating them.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button onClick={() => input.current?.click()}>
              {file ? 'Choose a different file' : 'Choose CSV file'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => download('flourishive-people-sample.csv', SAMPLE)}
            >
              Download a sample
            </Button>
            {file ? <span className="text-sm text-muted">{file.name}</span> : null}
          </div>
        </Card>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {preview ? (
          <Card>
            <CardTitle>2. Review</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="info">{preview.totalRows} rows</Badge>
              <Badge tone="success">{preview.willCreate.people} new</Badge>
              <Badge tone="neutral">{preview.willUpdate.people} to update</Badge>
              <Badge tone={preview.errors.length ? 'danger' : 'success'}>
                {preview.errors.length} problems
              </Badge>
            </div>
            {preview.errors.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-sm text-muted">
                  Fix these in your spreadsheet, then choose the file again. Nothing has been saved.
                </p>
                <Table compact>
                  <THead>
                    <TR>
                      <TH>Line</TH>
                      <TH>Column</TH>
                      <TH>Problem</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.errors.slice(0, 100).map((e, i) => (
                      <TR key={i}>
                        <TD>{e.line}</TD>
                        <TD className="font-mono text-xs">{e.field ?? ''}</TD>
                        <TD>{e.message}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {preview.errors.length > 100 ? (
                  <p className="mt-2 text-xs text-faint">
                    Showing the first 100 of {preview.errors.length}.
                  </p>
                ) : null}
              </div>
            ) : null}
            {preview.errors.some((e) =>
              /^Unknown (department|designation|location)/.test(e.message),
            ) || missing.length > 0 ? (
              <label className="mt-4 flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  checked={createMissing}
                  onChange={(e) => {
                    setCreateMissing(e.target.checked);
                    if (file) void check(file.text, e.target.checked);
                  }}
                />
                <span>
                  Create departments, designations and locations that do not exist yet
                  {missing.length ? (
                    <span className="block text-xs text-muted">Will add: {missing.join(', ')}</span>
                  ) : null}
                </span>
              </label>
            ) : null}
            <div className="mt-5 flex items-center gap-3">
              <Button size="lg" disabled={!preview.valid || busy} onClick={() => void commit()}>
                {busy
                  ? 'Importing…'
                  : preview.valid
                    ? `Import ${total} ${total === 1 ? 'person' : 'people'}`
                    : 'Import'}
              </Button>
              {!preview.valid ? (
                <span className="text-sm text-muted">Resolve the problems above to continue.</span>
              ) : null}
            </div>
          </Card>
        ) : null}

        {done ? (
          <Card>
            <CardTitle>Done</CardTitle>
            <p className="mt-2 text-sm text-muted">
              {done.willCreate.people} added and {done.willUpdate.people} updated.
            </p>
            <Button className="mt-4" onClick={() => go('/app/people')}>
              View people
            </Button>
          </Card>
        ) : null}
      </div>
    </Layout>
  );
}
