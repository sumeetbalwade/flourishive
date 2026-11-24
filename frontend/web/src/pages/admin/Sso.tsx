import type { SsoProvider } from '@flourishive/schemas';
import { Button, Card, CardTitle, Field, Input, Skeleton, Switch, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

/** The company's own single sign-on through Google Workspace or Microsoft 365 (D-16). */
export function Sso() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = useAuth().can('settings.manage');
  const q = useQuery({ queryKey: ['sso-config'], queryFn: () => api.sso.config() });
  const [d, setD] = useState({
    provider: 'GOOGLE' as SsoProvider,
    clientId: '',
    clientSecret: '',
    directoryId: '',
    hostedDomain: '',
    enabled: false,
    enforce: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.data)
      setD({
        provider: q.data.provider,
        clientId: q.data.clientId,
        clientSecret: '',
        directoryId: q.data.directoryId ?? '',
        hostedDomain: q.data.hostedDomain ?? '',
        enabled: q.data.enabled,
        enforce: q.data.enforce,
      });
  }, [q.data]);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  const redirectUri = q.data?.redirectUri;

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.sso.save({
        provider: d.provider,
        clientId: d.clientId,
        ...(d.clientSecret ? { clientSecret: d.clientSecret } : {}),
        directoryId: d.directoryId.trim() || null,
        hostedDomain: d.hostedDomain.trim() || null,
        enabled: d.enabled,
        enforce: d.enforce,
      });
      await qc.invalidateQueries({ queryKey: ['sso-config'] });
      toast({ title: 'Single sign-on saved', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout active="sso" title="Single sign-on">
      {q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Card>
          <CardTitle>Connect your identity provider</CardTitle>
          <p className="mt-1 text-sm text-muted">
            People sign in with their Google Workspace or Microsoft 365 account. It only signs in
            people who already have an account here; it never creates one. Two-step rules for their
            role still apply.
          </p>
          <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-muted">
            In your provider, register a web application and use this redirect address:
            <code className="mt-1 block break-all text-fg">
              {redirectUri ?? 'Save once to see the address.'}
            </code>
          </div>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={!canEdit || busy} className="contents">
              <Field label="Provider" htmlFor="sso-provider">
                <select
                  id="sso-provider"
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm"
                  value={d.provider}
                  onChange={(e) => set('provider', e.target.value as SsoProvider)}
                >
                  <option value="GOOGLE">Google Workspace</option>
                  <option value="MICROSOFT">Microsoft 365</option>
                </select>
              </Field>
              <Field label="Client ID" htmlFor="sso-client">
                <Input
                  id="sso-client"
                  value={d.clientId}
                  onChange={(e) => set('clientId', e.target.value)}
                />
              </Field>
              <Field
                label="Client secret"
                htmlFor="sso-secret"
                hint={q.data?.hasSecret ? 'Saved. Leave empty to keep it.' : undefined}
              >
                <Input
                  id="sso-secret"
                  type="password"
                  autoComplete="off"
                  value={d.clientSecret}
                  onChange={(e) => set('clientSecret', e.target.value)}
                />
              </Field>
              {d.provider === 'MICROSOFT' ? (
                <Field
                  label="Directory (tenant) ID"
                  htmlFor="sso-dir"
                  hint="From the app’s overview page in Microsoft Entra"
                >
                  <Input
                    id="sso-dir"
                    value={d.directoryId}
                    onChange={(e) => set('directoryId', e.target.value)}
                  />
                </Field>
              ) : (
                <Field
                  label="Workspace domain"
                  htmlFor="sso-hd"
                  hint="Optional. Only accounts on this domain, for example acme.com"
                >
                  <Input
                    id="sso-hd"
                    value={d.hostedDomain}
                    onChange={(e) => set('hostedDomain', e.target.value)}
                  />
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={d.enabled} onChange={(v) => set('enabled', v)} label="Enabled" />
                Show the single sign-on button
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={d.enforce} onChange={(v) => set('enforce', v)} label="Required" />
                Everyone but tenant admins must use it
              </label>
            </fieldset>
            <p className="text-xs text-muted sm:col-span-2">
              Allowed email domains (Company settings) also apply to single sign-on.
            </p>
            {error ? (
              <p role="alert" className="text-sm text-danger sm:col-span-2">
                {error}
              </p>
            ) : null}
            {canEdit ? (
              <div className="sm:col-span-2">
                <Button type="submit" loading={busy} disabled={!d.clientId.trim()}>
                  Save
                </Button>
              </div>
            ) : null}
          </form>
        </Card>
      )}
    </Layout>
  );
}
