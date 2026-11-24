import { Button, Card, CardTitle, Field, Input, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';

/** Who invoices are made out to. Needed before the first payment, so a GST invoice can be issued. */
export function BillingDetails({ canEdit }: { canEdit: boolean }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing-profile'], queryFn: () => api.billing.profile() });
  const [d, setD] = useState({
    legalName: '',
    gstin: '',
    address: '',
    stateCode: '',
    billingEmail: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.data)
      setD({
        legalName: q.data.legalName,
        gstin: q.data.gstin ?? '',
        address: q.data.address,
        stateCode: q.data.stateCode,
        billingEmail: q.data.billingEmail,
      });
  }, [q.data]);
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.billing.saveProfile({ ...d, gstin: d.gstin.trim() || null });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['billing-profile'] }),
        qc.invalidateQueries({ queryKey: ['billing-state'] }),
      ]);
      toast({ title: 'Billing details saved', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Billing details</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Printed on your GST invoices. Add your GSTIN if you want to claim input tax credit.
      </p>
      {q.isPending ? (
        <Skeleton className="mt-3 h-32 w-full" />
      ) : (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={!canEdit || busy} className="contents">
            <Field label="Legal name" htmlFor="bd-name">
              <Input
                id="bd-name"
                value={d.legalName}
                onChange={(e) => set('legalName', e.target.value)}
              />
            </Field>
            <Field label="GSTIN" htmlFor="bd-gstin" hint="Optional">
              <Input
                id="bd-gstin"
                value={d.gstin}
                onChange={(e) => set('gstin', e.target.value.toUpperCase())}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" htmlFor="bd-address">
                <Input
                  id="bd-address"
                  value={d.address}
                  onChange={(e) => set('address', e.target.value)}
                />
              </Field>
            </div>
            <Field label="State code" htmlFor="bd-state" hint="Two digits, for example 27">
              <Input
                id="bd-state"
                inputMode="numeric"
                maxLength={2}
                value={d.stateCode}
                onChange={(e) => set('stateCode', e.target.value)}
              />
            </Field>
            <Field label="Send invoices to" htmlFor="bd-email">
              <Input
                id="bd-email"
                type="email"
                value={d.billingEmail}
                onChange={(e) => set('billingEmail', e.target.value)}
              />
            </Field>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
          {canEdit ? (
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy}>
                Save billing details
              </Button>
            </div>
          ) : null}
        </form>
      )}
    </Card>
  );
}
