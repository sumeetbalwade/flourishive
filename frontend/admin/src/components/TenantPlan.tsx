import { LIMIT_METRICS, type LimitMap, type LimitMetric } from '@flourishive/schemas';
import {
  Badge,
  brand,
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';

const used = (v: number, limit: number | null, unit: string) =>
  `${Math.round(v * 100) / 100}${limit === null ? '' : ` of ${limit.toLocaleString('en-IN')}`} ${unit}`;

/** Which plan this company is on, what it has used, and any limit changed just for it (D-20). */
export function TenantPlan({ tenantId }: { tenantId: string }) {
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = can('billing.manage');
  const sub = useQuery({
    queryKey: ['tenant-subscription', tenantId],
    queryFn: () => api.billing.subscription(tenantId),
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.billing.plans() });
  const invoices = useQuery({
    queryKey: ['tenant-invoices', tenantId],
    queryFn: () => api.billing.invoices(tenantId),
  });
  const [planId, setPlanId] = useState('');
  const [over, setOver] = useState<Partial<Record<LimitMetric, number | null>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sub.data) return;
    setPlanId(sub.data.plan.id);
    setOver(
      Object.fromEntries(
        sub.data.overridden.map((m) => [m, sub.data.limits[m]]),
      ) as Partial<LimitMap>,
    );
  }, [sub.data]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const next = await api.billing.assign(tenantId, {
        planId,
        status: sub.data?.status ?? 'ACTIVE',
        limitOverrides: Object.keys(over).length ? over : null,
      });
      qc.setQueryData(['tenant-subscription', tenantId], next);
      await qc.invalidateQueries({ queryKey: ['plans'] });
      toast({ title: 'Plan saved', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <CardTitle>Plan and limits</CardTitle>
        {sub.data ? <Badge>{sub.data.status.replace('_', ' ').toLowerCase()}</Badge> : null}
      </div>
      {sub.isPending ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : sub.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {messageOf(sub.error)}
        </p>
      ) : (
        <div className="mt-3 grid gap-4">
          <Field label="Plan" htmlFor="tp-plan">
            <select
              id="tp-plan"
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm"
              value={planId}
              disabled={!canEdit || busy}
              onChange={(e) => setPlanId(e.target.value)}
            >
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <ul className="grid gap-3">
            {LIMIT_METRICS.map((m) => {
              const limit = sub.data.limits[m.key];
              const custom = m.key in over;
              return (
                <li key={m.key} className="grid gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-muted">{used(sub.data.usage[m.key], limit, m.unit)}</span>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`${m.label} for this company only`}
                        type="number"
                        min={0}
                        placeholder={custom ? 'Unlimited' : 'Follows the plan'}
                        value={custom ? (over[m.key] ?? '') : ''}
                        onChange={(e) =>
                          setOver((o) => ({
                            ...o,
                            [m.key]:
                              e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                          }))
                        }
                      />
                      {custom ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setOver((o) => {
                              const { [m.key]: _drop, ...rest } = o;
                              return rest;
                            })
                          }
                        >
                          Follow plan
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {invoices.data && invoices.data.length > 0 ? (
            <div>
              <div className="text-sm font-medium">Invoices</div>
              <ul className="mt-2 grid gap-1 text-sm">
                {invoices.data.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {i.number}{' '}
                      <span className="text-muted">
                        {new Date(i.issuedAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      ₹{(i.total / 100).toLocaleString('en-IN')}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api.billing
                            .invoiceLink(tenantId, i.id)
                            .then((l) => window.open(`${brand.apiUrl}${l.url}`, '_blank'))
                            .catch((e) => setError(messageOf(e)))
                        }
                      >
                        PDF
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {canEdit ? (
            <div>
              <Button loading={busy} onClick={() => void save()}>
                Save plan
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
