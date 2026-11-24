import { LIMIT_METRICS, type LimitMap, type PlanView } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Switch,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

export const rupees = (paise: number) =>
  paise === 0 ? 'Free' : `₹${(paise / 100).toLocaleString('en-IN')}`;

const blank = {
  key: '',
  name: '',
  description: '',
  priceMonthly: 0,
  priceYearly: 0,
  isPublic: true,
  isDefault: false,
  active: true,
  sortOrder: 50,
  limits: { users: 10, storage_mb: 1024, signatures_month: 50 } as LimitMap,
};

type Draft = typeof blank;

const toDraft = (p: PlanView): Draft => ({
  key: p.key,
  name: p.name,
  description: p.description,
  priceMonthly: p.priceMonthly,
  priceYearly: p.priceYearly,
  isPublic: p.isPublic,
  isDefault: p.isDefault,
  active: p.active,
  sortOrder: p.sortOrder,
  limits: p.limits,
});

/** A whole number, or empty for unlimited. */
function LimitInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      min={0}
      inputMode="numeric"
      placeholder="Unlimited"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
    />
  );
}

function PlanForm({
  plan,
  canEdit,
  onDone,
}: {
  plan?: PlanView;
  canEdit: boolean;
  onDone: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(plan ? toDraft(plan) : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const id = plan?.id ?? 'new';

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (plan) await api.billing.updatePlan(plan.id, d);
      else await api.billing.createPlan(d);
      await qc.invalidateQueries({ queryKey: ['plans'] });
      toast({ title: plan ? 'Plan saved' : 'Plan added', tone: 'success' });
      onDone();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      await api.billing.removePlan(plan.id);
      await qc.invalidateQueries({ queryKey: ['plans'] });
      toast({ title: 'Plan removed', tone: 'success' });
      onDone();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit || busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Key" htmlFor={`${id}-key`} hint="Lowercase letters, digits, dashes">
          <Input
            id={`${id}-key`}
            value={d.key}
            onChange={(e) => set('key', e.target.value.toLowerCase())}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="What it is for" htmlFor={`${id}-desc`}>
            <Input
              id={`${id}-desc`}
              value={d.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Price per month (₹)" htmlFor={`${id}-pm`} hint="0 for free">
          <Input
            id={`${id}-pm`}
            type="number"
            min={0}
            value={d.priceMonthly / 100}
            onChange={(e) => set('priceMonthly', Math.round(Number(e.target.value) * 100))}
          />
        </Field>
        <Field label="Price per year (₹)" htmlFor={`${id}-py`} hint="0 for free">
          <Input
            id={`${id}-py`}
            type="number"
            min={0}
            value={d.priceYearly / 100}
            onChange={(e) => set('priceYearly', Math.round(Number(e.target.value) * 100))}
          />
        </Field>
        {LIMIT_METRICS.map((m) => (
          <Field
            key={m.key}
            label={`${m.label} (${m.unit})`}
            htmlFor={`${id}-${m.key}`}
            hint="Leave empty for unlimited"
          >
            <LimitInput
              id={`${id}-${m.key}`}
              value={d.limits[m.key]}
              onChange={(v) => set('limits', { ...d.limits, [m.key]: v })}
            />
          </Field>
        ))}
        <Field label="Order in lists" htmlFor={`${id}-order`}>
          <Input
            id={`${id}-order`}
            type="number"
            min={0}
            value={d.sortOrder}
            onChange={(e) => set('sortOrder', Number(e.target.value))}
          />
        </Field>
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.isPublic} onChange={(v) => set('isPublic', v)} label="Public" />
            Companies can choose it
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.active} onChange={(v) => set('active', v)} label="Active" />
            On sale
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.isDefault} onChange={(v) => set('isDefault', v)} label="Default" />
            New companies start here
          </label>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy} disabled={!d.name.trim() || !d.key}>
            {plan ? 'Save plan' : 'Add plan'}
          </Button>
          {plan ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove plan
            </Button>
          ) : null}
          <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
            Cancel
          </Button>
        </div>
      ) : null}
    </form>
  );
}

const limitText = (v: number | null, unit: string) =>
  v === null ? 'Unlimited' : `${v.toLocaleString('en-IN')} ${unit}`;

/** The plans companies can be on, with their prices and limits (D-20). */
export function Plans() {
  const api = useApi();
  const can = useCan();
  const q = useQuery({ queryKey: ['plans'], queryFn: () => api.billing.plans() });
  const [open, setOpen] = useState<string | null>(null);
  const canEdit = can('billing.manage');
  return (
    <Layout
      active="plans"
      title="Plans"
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => setOpen('new')}>
            Add a plan
          </Button>
        ) : undefined
      }
    >
      {q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(q.error)}
        </p>
      ) : (
        <div className="grid gap-4">
          {open === 'new' ? (
            <Card>
              <CardTitle>New plan</CardTitle>
              <PlanForm canEdit={canEdit} onDone={() => setOpen(null)} />
            </Card>
          ) : null}
          {q.data.length === 0 ? (
            <EmptyState title="No plans yet" description="Add the first plan." />
          ) : (
            q.data.map((p) => (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{p.name}</CardTitle>
                      {p.isDefault ? <Badge tone="accent">Default</Badge> : null}
                      {!p.isPublic ? <Badge>Internal</Badge> : null}
                      {!p.active ? <Badge tone="warning">Off sale</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted">{p.description}</p>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium">{rupees(p.priceMonthly)} / month</div>
                    <div className="text-muted">{rupees(p.priceYearly)} / year</div>
                    <div className="mt-1 text-xs text-muted">
                      {p.companies} {p.companies === 1 ? 'company' : 'companies'}
                    </div>
                  </div>
                </div>
                <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
                  {LIMIT_METRICS.map((m) => (
                    <li key={m.key}>
                      <span className="text-muted">{m.label}: </span>
                      {limitText(p.limits[m.key], m.unit)}
                    </li>
                  ))}
                </ul>
                {open === p.id ? (
                  <PlanForm plan={p} canEdit={canEdit} onDone={() => setOpen(null)} />
                ) : (
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={() => setOpen(p.id)}>
                      {canEdit ? 'Edit' : 'View'}
                    </Button>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}
    </Layout>
  );
}
