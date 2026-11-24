import { LIMIT_METRICS } from '@flourishive/schemas';
import { Badge, brand, Button, Card, CardTitle, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../lib/auth.tsx';
import { payWithRazorpay } from '../../lib/razorpay.ts';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { BillingDetails } from './BillingDetails.tsx';
import { Layout } from '../Layout.tsx';

const rupees = (paise: number) =>
  paise === 0 ? 'Free' : `₹${(paise / 100).toLocaleString('en-IN')}`;

function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
}) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const tone = pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-accent';
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          {Math.round(used * 100) / 100}
          {limit === null ? ` ${unit}, no limit` : ` of ${limit.toLocaleString('en-IN')} ${unit}`}
        </span>
      </div>
      {limit !== null ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-2"
        >
          <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {pct >= 100 ? (
        <p className="mt-1 text-xs text-danger">Limit reached. Upgrade to add more.</p>
      ) : pct >= 80 ? (
        <p className="mt-1 text-xs text-muted">You are close to the limit.</p>
      ) : null}
    </div>
  );
}

/** The company's plan, what it allows and how much is used (D-20). */
export function Plan() {
  const api = useApi();
  const can = useAuth().can;
  const sub = useQuery({ queryKey: ['billing-plan'], queryFn: () => api.billing.plan() });
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: () => api.billing.plans() });
  const invoices = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => api.billing.invoices(),
    enabled: can('settings.read'),
  });
  const state = useQuery({ queryKey: ['billing-state'], queryFn: () => api.billing.state() });
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const canPay =
    can('settings.manage') && state.data?.paymentsEnabled && state.data.profileComplete;
  const refresh = () =>
    Promise.all(
      ['billing-plan', 'billing-state', 'billing-plans'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );

  async function pay(planId: string, interval: 'MONTHLY' | 'YEARLY') {
    setBusy(`${planId}:${interval}`);
    setError('');
    try {
      const c = await api.billing.checkout({ planId, interval });
      const proof = await payWithRazorpay(c);
      if (proof) {
        await api.billing.confirm(proof);
        toast({ title: 'Payment received. Your plan is updated.', tone: 'success' });
      }
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy('cancel');
    setError('');
    try {
      await api.billing.cancel();
      toast({ title: 'Subscription will end at the close of the paid period', tone: 'success' });
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Layout active="plan" title="Plan and usage">
      {sub.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : sub.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(sub.error)}
        </p>
      ) : (
        <div className="grid gap-4">
          <Card>
            <div className="flex items-center gap-2">
              <CardTitle>{sub.data.plan.name}</CardTitle>
              <Badge tone={sub.data.status === 'ACTIVE' ? 'success' : 'warning'}>
                {sub.data.status.replace('_', ' ').toLowerCase()}
              </Badge>
            </div>
            <div className="mt-4 grid gap-5">
              {LIMIT_METRICS.map((m) => (
                <Meter
                  key={m.key}
                  label={m.label}
                  unit={m.unit}
                  used={sub.data.usage[m.key]}
                  limit={sub.data.limits[m.key]}
                />
              ))}
            </div>
          </Card>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {sub.data.status === 'PAST_DUE' || sub.data.status === 'READ_ONLY' ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm"
            >
              {sub.data.status === 'READ_ONLY'
                ? 'Your account is read-only because a payment is overdue. Pay to switch editing back on.'
                : `A payment did not go through.${
                    state.data?.graceEndsAt
                      ? ` Fix it by ${new Date(state.data.graceEndsAt).toLocaleDateString()} to avoid read-only mode.`
                      : ''
                  }`}
            </div>
          ) : null}
          {can('settings.read') ? <BillingDetails canEdit={can('settings.manage')} /> : null}
          {state.data?.paymentsEnabled && !state.data.profileComplete ? (
            <p className="text-sm text-muted">Save your billing details to unlock payment.</p>
          ) : null}
          {state.data && !state.data.paymentsEnabled ? (
            <p className="text-sm text-muted">
              Online payment is not switched on yet. Contact support to change your plan.
            </p>
          ) : null}
          {state.data?.hasSubscription ? (
            <Card>
              <CardTitle>Subscription</CardTitle>
              <p className="mt-2 text-sm text-muted">
                Billed {state.data.interval === 'YEARLY' ? 'yearly' : 'monthly'}.{' '}
                {state.data.cancelAtPeriodEnd ? 'It ends' : 'It renews'} on{' '}
                {state.data.renewsAt
                  ? new Date(state.data.renewsAt).toLocaleDateString()
                  : 'the next billing date'}
                .
              </p>
              {can('settings.manage') && !state.data.cancelAtPeriodEnd ? (
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === 'cancel'}
                    disabled={busy !== null}
                    onClick={() => void cancel()}
                  >
                    Cancel subscription
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
          {plans.data && plans.data.length > 0 ? (
            <Card>
              <CardTitle>Plans you can choose</CardTitle>
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {plans.data.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-line p-3 text-sm"
                    aria-current={p.id === sub.data.plan.id ? 'true' : undefined}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted">{rupees(p.priceMonthly)} per month</div>
                    <ul className="mt-2 grid gap-1 text-xs text-muted">
                      {LIMIT_METRICS.map((m) => (
                        <li key={m.key}>
                          {p.limits[m.key] === null
                            ? 'Unlimited'
                            : p.limits[m.key]!.toLocaleString('en-IN')}{' '}
                          {m.unit}
                        </li>
                      ))}
                    </ul>
                    {p.id === sub.data.plan.id ? (
                      <Badge tone="accent">Your plan</Badge>
                    ) : canPay && p.priceMonthly > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          loading={busy === `${p.id}:MONTHLY`}
                          disabled={busy !== null}
                          onClick={() => void pay(p.id, 'MONTHLY')}
                        >
                          Pay {rupees(p.priceMonthly)} monthly
                        </Button>
                        {p.priceYearly > 0 ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === `${p.id}:YEARLY`}
                            disabled={busy !== null}
                            onClick={() => void pay(p.id, 'YEARLY')}
                          >
                            Pay {rupees(p.priceYearly)} yearly
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {state.data && state.data.payments.length > 0 ? (
            <Card>
              <CardTitle>Payments</CardTitle>
              <ul className="mt-3 grid gap-2 text-sm">
                {state.data.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2">
                    <span>{new Date(p.at).toLocaleDateString()}</span>
                    <span>
                      {rupees(p.amount)}{' '}
                      <Badge tone={p.status === 'CAPTURED' ? 'success' : 'danger'}>
                        {p.status.toLowerCase()}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {invoices.data && invoices.data.length > 0 ? (
            <Card>
              <CardTitle>Invoices</CardTitle>
              <ul className="mt-3 grid gap-2 text-sm">
                {invoices.data.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {i.number}{' '}
                      <span className="text-muted">
                        {new Date(i.issuedAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {rupees(i.total)}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void api.billing
                            .invoiceLink(i.id)
                            .then((l) => window.open(`${brand.apiUrl}${l.url}`, '_blank'))
                            .catch((e) => setError(messageOf(e)))
                        }
                      >
                        Download PDF
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
