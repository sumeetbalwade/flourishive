import { Badge, Button, Card, CardTitle, Field, Input, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';

/** For the signatory, when the company allows it: sign here without the USB token, with an authenticator code. */
export function ElectronicSignPanel({ id }: { id: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const opts = useQuery({
    queryKey: ['document', id, 'electronic'],
    queryFn: () => api.documents.electronicOptions(id),
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!opts.data?.allowed || !opts.data.requestId) return null;
  const requestId = opts.data.requestId;

  async function sign() {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6 digits from your authenticator app.');
    setBusy(true);
    setError('');
    try {
      await api.documents.signElectronically(id, requestId, code);
      toast({ tone: 'success', title: 'Signed and issued' });
      await qc.invalidateQueries({ queryKey: ['document', id] });
      await qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardTitle>Sign without the token</CardTitle>
      <p className="mt-1 text-sm text-muted">
        The letter gets a visible signature stamp and the organisation seal. It is marked{' '}
        <Badge tone="warning">Signed electronically (no DSC)</Badge> and is not a digital signature
        certificate signature.
      </p>
      <div className="mt-4 grid gap-3">
        <Field label="Authenticator code" htmlFor="e-code">
          <Input
            id="e-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          size="sm"
          className="justify-self-start"
          loading={busy}
          disabled={busy}
          onClick={() => void sign()}
        >
          Sign now
        </Button>
      </div>
    </Card>
  );
}
