import { FEATURES, LIMIT_METRICS, type CreateTenantBody } from '@flourishive/schemas';
import { Button, Dialog, DialogContent, Field, Input, Switch, useToast } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';

/** Suggests a company code from a name: "Acme Logistics Pvt Ltd" -> "acme-logistics". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const STEPS = [
  'Company',
  'First admin',
  'Brand',
  'Email',
  'Security',
  'Plan',
  'Features',
  'Alerts',
  'Review',
] as const;

interface Draft {
  step: number;
  name: string;
  slug: string;
  slugTouched: boolean;
  legalName: string;
  adminEmail: string;
  allowedDomains: string;
  trustedDeviceDays: string;
  planId: string;
  off: string[];
}
const EMPTY: Draft = {
  step: 0,
  name: '',
  slug: '',
  slugTouched: false,
  legalName: '',
  adminEmail: '',
  allowedDomains: '',
  trustedDeviceDays: '',
  planId: '',
  off: [],
};
const KEY = 'fh.newTenantDraft';

function load(): Draft {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Draft>) };
  } catch {
    return EMPTY;
  }
}

const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
export const parseDomains = (raw: string) =>
  raw
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

/**
 * The "New tenant" wizard (D-71). Each step can be skipped where the default is safe. What has been typed is kept
 * on this computer as a draft until the tenant is created, so closing the window does not lose it.
 */
export function NewTenantWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const api = useApi();
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.billing.plans().then((all) => all.filter((p) => p.active)),
  });
  const defaultPlan = plans.data?.find((p) => p.isDefault)?.id ?? '';
  const toast = useToast();
  const [d, setD] = useState<Draft>(load);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(d));
  }, [d]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const goto = (step: number) => {
    setTried(false);
    set({ step });
  };

  const domains = parseDomains(d.allowedDomains);
  const badDomain = domains.find((x) => !DOMAIN.test(x));
  const days = d.trustedDeviceDays.trim() === '' ? null : Number(d.trustedDeviceDays);
  const stepError = (() => {
    if (d.step === 0 && (!d.name.trim() || !d.slug.trim()))
      return 'Enter the company name and code.';
    if (d.step === 1 && !/^\S+@\S+\.\S+$/.test(d.adminEmail.trim()))
      return 'Enter the first admin’s email address.';
    if (d.step === 4 && badDomain) return `“${badDomain}” is not a valid domain.`;
    if (d.step === 4 && days !== null && (!Number.isInteger(days) || days < 0 || days > 90))
      return 'Trusted device days must be a whole number from 0 to 90.';
    return '';
  })();

  async function create() {
    const body: CreateTenantBody = {
      slug: d.slug.trim(),
      name: d.name.trim(),
      companyName: d.name.trim(),
      legalName: d.legalName.trim() || d.name.trim(),
      adminEmail: d.adminEmail.trim(),
      ...(d.planId || defaultPlan ? { planId: d.planId || defaultPlan } : {}),
    };
    setBusy(true);
    setErrors([]);
    try {
      const t = await api.tenants.create(body);
      // Optional choices are applied after the company exists. A failure here is reported, not fatal.
      const notes: string[] = [];
      try {
        if (domains.length)
          await api.tenants.setSetting(t.id, 'signin.allowedEmailDomains', domains);
        if (days !== null) await api.tenants.setSetting(t.id, 'security.trustedDeviceDays', days);
        for (const key of d.off) await api.controls.setFeature(t.id, key, false);
      } catch (e) {
        notes.push(
          `Some choices were not saved (${messageOf(e)}). You can set them on the tenant page.`,
        );
      }
      localStorage.removeItem(KEY);
      setD(EMPTY);
      toast({
        title: `${t.name} created`,
        description: notes[0] ?? `An invitation went to ${t.adminEmail}.`,
        tone: notes.length ? 'info' : 'success',
      });
      onOpenChange(false);
      onCreated(t.id);
    } catch (err) {
      const details = (err as { details?: string[] }).details;
      setErrors(details?.length ? details : [messageOf(err)]);
    } finally {
      setBusy(false);
    }
  }

  const last = d.step === STEPS.length - 1;
  const skippable = d.step >= 2 && d.step <= 6;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New tenant"
        description={`Step ${d.step + 1} of ${STEPS.length}: ${STEPS[d.step]}`}
      >
        <ol className="mb-4 flex gap-1" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === d.step ? 'step' : undefined}
              title={s}
              className={`h-1.5 flex-1 rounded-full ${i <= d.step ? 'bg-accent' : 'bg-surface-2'}`}
            />
          ))}
        </ol>

        <div className="grid min-h-48 content-start gap-4">
          {d.step === 0 ? (
            <>
              <Field label="Company name" htmlFor="w-name">
                <Input
                  id="w-name"
                  value={d.name}
                  onChange={(e) =>
                    set({
                      name: e.target.value,
                      slug: d.slugTouched ? d.slug : slugify(e.target.value),
                    })
                  }
                />
              </Field>
              <Field
                label="Company code"
                htmlFor="w-slug"
                hint="Part of the company’s web address and typed at sign-in. Lowercase letters, digits and hyphens."
              >
                <Input
                  id="w-slug"
                  value={d.slug}
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => set({ slug: e.target.value.toLowerCase(), slugTouched: true })}
                />
              </Field>
              <Field
                label="Legal name"
                htmlFor="w-legal"
                hint="As on letters, for example Acme Logistics Pvt Ltd. Defaults to the company name."
              >
                <Input
                  id="w-legal"
                  value={d.legalName}
                  onChange={(e) => set({ legalName: e.target.value })}
                />
              </Field>
            </>
          ) : null}
          {d.step === 1 ? (
            <Field
              label="First admin’s email"
              htmlFor="w-admin"
              hint="They get an email to choose a password and then run the company."
            >
              <Input
                id="w-admin"
                type="email"
                value={d.adminEmail}
                onChange={(e) => set({ adminEmail: e.target.value })}
              />
            </Field>
          ) : null}
          {d.step === 2 ? (
            <p className="text-sm text-muted">
              The company starts with the product’s look. Its admin picks a logo, colours and fonts
              on their own Brand screen, and a “Finish setting up” list on their Home page reminds
              them. Nothing to do here.
            </p>
          ) : null}
          {d.step === 3 ? (
            <p className="text-sm text-muted">
              Email goes out from the platform’s address until the company verifies its own sender
              under Email sender. That is safe to leave as it is.
            </p>
          ) : null}
          {d.step === 4 ? (
            <>
              <Field
                label="Allowed email domains"
                htmlFor="w-dom"
                hint="Optional. Only people with these domains can be invited, for example acme.com. Separate with commas. Leave empty to allow any."
              >
                <Input
                  id="w-dom"
                  value={d.allowedDomains}
                  onChange={(e) => set({ allowedDomains: e.target.value })}
                />
              </Field>
              <Field
                label="Remember a trusted device for (days)"
                htmlFor="w-days"
                hint="Optional. Leave empty to use the platform default. 0 asks for the code every time."
              >
                <Input
                  id="w-days"
                  inputMode="numeric"
                  value={d.trustedDeviceDays}
                  onChange={(e) => set({ trustedDeviceDays: e.target.value })}
                />
              </Field>
              <p className="text-xs text-muted">
                Two-step sign-in per role follows the platform’s security policy. Change it later on
                the Security policy screen.
              </p>
            </>
          ) : null}
          {d.step === 5 ? (
            <>
              <p className="text-sm text-muted">
                Choose the plan this company starts on. Limits can be adjusted for this company
                later.
              </p>
              <ul className="grid gap-2">
                {plans.data?.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm">
                      <input
                        type="radio"
                        name="w-plan"
                        checked={(d.planId || defaultPlan) === p.id}
                        onChange={() => set({ planId: p.id })}
                      />
                      <span>
                        <span className="font-medium">{p.name}</span>{' '}
                        <span className="text-muted">
                          {p.priceMonthly === 0
                            ? 'Free'
                            : `₹${(p.priceMonthly / 100).toLocaleString('en-IN')} per month`}
                        </span>
                        <span className="block text-xs text-muted">
                          {LIMIT_METRICS.map(
                            (m) =>
                              `${p.limits[m.key] === null ? 'Unlimited' : p.limits[m.key]!.toLocaleString('en-IN')} ${m.unit}`,
                          ).join(' · ')}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {d.step === 6 ? (
            <ul className="grid gap-3">
              {FEATURES.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted">{f.hint}</div>
                  </div>
                  <Switch
                    checked={!d.off.includes(f.key)}
                    label={f.label}
                    onChange={(on) =>
                      set({ off: on ? d.off.filter((k) => k !== f.key) : [...d.off, f.key] })
                    }
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {d.step === 7 ? (
            <p className="text-sm text-muted">
              Alert emails are chosen by each person. The company’s admin picks theirs under My
              alerts, and nothing is sent until they turn it on. You choose yours under My alerts in
              this console.
            </p>
          ) : null}
          {last ? (
            <dl className="grid gap-2 text-sm">
              <Row k="Company" v={`${d.name} (${d.slug})`} />
              <Row k="Legal name" v={d.legalName.trim() || d.name} />
              <Row k="First admin" v={d.adminEmail} />
              <Row
                k="Plan"
                v={plans.data?.find((p) => p.id === (d.planId || defaultPlan))?.name ?? 'Default'}
              />
              <Row k="Allowed domains" v={domains.length ? domains.join(', ') : 'Any'} />
              <Row k="Trusted devices" v={days === null ? 'Platform default' : `${days} days`} />
              <Row
                k="Switched off"
                v={
                  d.off.length
                    ? FEATURES.filter((f) => d.off.includes(f.key))
                        .map((f) => f.label)
                        .join(', ')
                    : 'Nothing'
                }
              />
            </dl>
          ) : null}
        </div>

        {errors.length ? (
          <ul role="alert" className="mt-3 grid gap-1 text-sm text-danger">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : stepError && tried ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {stepError}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={d.step === 0 || busy} onClick={() => goto(d.step - 1)}>
            Back
          </Button>
          <div className="flex gap-2">
            {skippable && !stepError ? (
              <Button variant="secondary" onClick={() => goto(d.step + 1)}>
                Skip
              </Button>
            ) : null}
            {last ? (
              <Button loading={busy} disabled={busy} onClick={() => void create()}>
                {busy ? 'Creating…' : 'Create tenant'}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (stepError) setTried(true);
                  else goto(d.step + 1);
                }}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
