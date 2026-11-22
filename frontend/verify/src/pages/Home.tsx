import { Button, Card, Field, Input } from '@flourishive/ui';
import { ScanSearch } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiProblem, verifyApi } from '../api.ts';
import { navigate } from '../router.ts';

/** Look a document up by the company and the reference printed on it. */
export function Home() {
  const [company, setCompany] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await verifyApi.lookup(company.trim(), reference.trim());
      navigate(`/d/${r.token ?? ''}`);
    } catch (err) {
      setError(
        err instanceof ApiProblem && err.status === 404
          ? 'No issued document matches that company and reference. Check both and try again.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="grid gap-5 p-8">
      <div className="grid gap-1">
        <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-accent-lo text-accent ring-8 ring-accent-lo/50">
          <ScanSearch size={26} />
        </span>
        <h1 className="font-display text-3xl">Check a document</h1>
        <p className="text-sm text-muted">
          Scan the QR code on the document, or enter the company's short name and the reference
          printed at its top.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <Field
          label="Company short name"
          htmlFor="company"
          hint="The first part of the company's address, for example flourisense"
        >
          <Input
            id="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        <Field label="Reference" htmlFor="reference" hint="For example FS/INT/2026/0012">
          <Input
            id="reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" loading={busy} disabled={busy}>
          {busy ? 'Checking…' : 'Check document'}
        </Button>
      </form>
    </Card>
  );
}
