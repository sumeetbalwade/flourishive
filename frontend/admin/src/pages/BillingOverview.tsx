import { LIMIT_METRICS } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Skeleton,
  Stat,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const labelOf = (k: string) => LIMIT_METRICS.find((m) => m.key === k);

/** Revenue, overdue companies, companies close to their limits, and payment webhooks that failed. */
export function BillingOverview() {
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['billing-overview'],
    queryFn: () => api.billing.overview(),
    refetchInterval: 60_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(id: string) {
    setBusy(id);
    try {
      qc.setQueryData(['billing-overview'], await api.billing.retryEvent(id));
      toast({ title: 'Event processed again', tone: 'success' });
    } catch (e) {
      toast({ title: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Layout active="billing" title="Billing">
      {q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(q.error)}
        </p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Companies" value={String(q.data.totals.companies)} />
            <Stat label="Paying" value={String(q.data.totals.paying)} />
            <Stat label="Monthly revenue" value={inr(q.data.totals.mrr)} />
            <Stat label="Payment overdue" value={String(q.data.totals.pastDue)} />
            <Stat label="Read-only" value={String(q.data.totals.readOnly)} />
            <Stat label="Suspended" value={String(q.data.totals.suspended)} />
          </div>

          <Card>
            <CardTitle>Close to a plan limit</CardTitle>
            {q.data.nearLimit.length === 0 ? (
              <EmptyState
                title="Nobody is near a limit"
                description="Companies at 80% or more of a limit appear here."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Company</TH>
                    <TH>Plan</TH>
                    <TH>Limit</TH>
                    <TH>Used</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.data.nearLimit.map((n) => (
                    <TR
                      key={`${n.tenantId}-${n.metric}`}
                      className="cursor-pointer"
                      onClick={() => go(`/tenants/${n.tenantId}`)}
                    >
                      <TD>{n.name}</TD>
                      <TD>{n.plan}</TD>
                      <TD>{labelOf(n.metric)?.label}</TD>
                      <TD>
                        <Badge tone={n.percent >= 100 ? 'danger' : 'warning'}>{n.percent}%</Badge>{' '}
                        {Math.round(n.used * 100) / 100} of {n.limit.toLocaleString('en-IN')}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardTitle>Company webhook endpoints that are failing</CardTitle>
            {q.data.deliveryFailures.length === 0 ? (
              <EmptyState
                title="No failing endpoints"
                description="Events companies subscribed to are reaching them."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Company</TH>
                    <TH>Endpoint</TH>
                    <TH>Gave up (7 days)</TH>
                    <TH>Last error</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.data.deliveryFailures.map((f) => (
                    <TR
                      key={`${f.tenantId}-${f.host}`}
                      className="cursor-pointer"
                      onClick={() => go(`/tenants/${f.tenantId}`)}
                    >
                      <TD>{f.name}</TD>
                      <TD className="font-mono text-xs">{f.host}</TD>
                      <TD>{f.failed}</TD>
                      <TD className="max-w-xs truncate text-xs text-muted">{f.lastError}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardTitle>Payment webhooks that failed</CardTitle>
            {q.data.failures.length === 0 ? (
              <EmptyState
                title="No failed webhooks"
                description="Events from the payment provider are being processed."
              />
            ) : (
              <ul className="mt-3 grid gap-2 text-sm">
                {q.data.failures.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{f.type}</div>
                      <div className="truncate text-xs text-muted">
                        {new Date(f.at).toLocaleString()} · {f.error}
                      </div>
                    </div>
                    {can('billing.manage') ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === f.id}
                        onClick={() => void retry(f.id)}
                      >
                        Try again
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Layout>
  );
}
