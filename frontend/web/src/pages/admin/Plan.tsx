import { LIMIT_METRICS } from '@flourishive/schemas';
import { Badge, Card, CardTitle, Skeleton } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
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
  const sub = useQuery({ queryKey: ['billing-plan'], queryFn: () => api.billing.plan() });
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: () => api.billing.plans() });
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
                    {p.id === sub.data.plan.id ? <Badge tone="accent">Your plan</Badge> : null}
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
