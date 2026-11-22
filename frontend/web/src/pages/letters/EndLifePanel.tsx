import { Badge, Button, Card, CardTitle, Field, Input, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';

/** Withdraw an issued letter, or replace it with a newer issued one. The reason is kept. */
export function EndLifePanel({
  id,
  personId,
  status,
  statusReason,
}: {
  id: string;
  personId: string | null;
  status: string;
  statusReason: string | null;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [replacement, setReplacement] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const others = useQuery({
    queryKey: ['documents', 'replacements', personId],
    queryFn: () => api.documents.list({ personId: personId ?? undefined, pageSize: 50 }),
    enabled: !!personId && status === 'GENERATED',
  });

  if (status !== 'GENERATED')
    return (
      <Card>
        <CardTitle>{status === 'REVOKED' ? 'Withdrawn' : 'Replaced'}</CardTitle>
        <p className="mt-2 text-sm text-muted">{statusReason}</p>
      </Card>
    );

  async function run(fn: () => Promise<unknown>, done: string) {
    if (reason.trim().length < 3) return setError('Give a reason (a few words).');
    setBusy(true);
    setError('');
    try {
      await fn();
      toast({ tone: 'success', title: done });
      await qc.invalidateQueries({ queryKey: ['document', id] });
      await qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const candidates = (others.data?.items ?? []).filter((d) => d.id !== id && d.state === 'issued');
  return (
    <Card>
      <CardTitle>Withdraw or replace</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Anyone who checks this letter will be told it was withdrawn or replaced. Emailed links stop
        working.
      </p>
      <div className="mt-4 grid gap-3">
        <Field label="Reason" htmlFor="e-reason">
          <Input id="e-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {candidates.length > 0 ? (
          <Field label="Replaced by (optional)" htmlFor="e-new">
            <SelectField
              id="e-new"
              value={replacement}
              placeholder="Choose the newer letter"
              onChange={setReplacement}
              options={candidates.map((d) => ({ value: d.id, label: d.reference }))}
            />
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {replacement ? (
            <Button
              size="sm"
              loading={busy}
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.documents.supersede(id, replacement, reason.trim()),
                  'Letter replaced',
                )
              }
            >
              Replace
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              disabled={busy}
              onClick={() =>
                void run(() => api.documents.revoke(id, reason.trim()), 'Letter withdrawn')
              }
            >
              Withdraw
            </Button>
          )}
          <Badge tone="neutral">Cannot be undone</Badge>
        </div>
      </div>
    </Card>
  );
}
