import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';
import { fmt } from './Tenants.tsx';

/** A typed value from a text box: numbers stay numbers so the server's schema accepts them. */
export const parseValue = (raw: string): unknown =>
  raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw.trim();

export function TenantDetail({ id }: { id: string }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const tenant = useQuery({ queryKey: ['tenant', id], queryFn: () => api.tenants.get(id) });
  const defs = useQuery({ queryKey: ['platform-settings'], queryFn: () => api.settings.list() });
  const [confirm, setConfirm] = useState<null | 'SUSPENDED' | 'ACTIVE'>(null);
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['tenant', id] }),
      qc.invalidateQueries({ queryKey: ['tenants'] }),
    ]);

  async function act(fn: () => Promise<unknown>, ok: string, done?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: 'success' });
      done?.();
      await refresh();
    } catch (e) {
      toast({ title: 'That did not work', description: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (tenant.isError)
    return (
      <Layout active="tenants" title="Tenant">
        <EmptyState
          title="Could not open this tenant"
          description={messageOf(tenant.error)}
          action={
            <Button variant="secondary" onClick={() => go('/tenants')}>
              Back to tenants
            </Button>
          }
        />
      </Layout>
    );
  if (!tenant.data)
    return (
      <Layout active="tenants" title="Tenant">
        <Skeleton className="h-64 w-full" />
      </Layout>
    );
  const t = tenant.data;
  const active = t.status === 'ACTIVE';

  return (
    <Layout
      active="tenants"
      title={t.name}
      actions={
        <Button
          size="sm"
          variant={active ? 'danger' : 'primary'}
          onClick={() => setConfirm(active ? 'SUSPENDED' : 'ACTIVE')}
        >
          {active ? 'Suspend…' : 'Reactivate'}
        </Button>
      }
    >
      <p className="mb-5 flex items-center gap-2 text-sm text-muted">
        <a href="#/tenants" className="underline">
          Tenants
        </a>{' '}
        / {t.name}
        <Badge tone={active ? 'success' : 'danger'}>{active ? 'Active' : 'Suspended'}</Badge>
        <span>
          · code <code className="font-mono">{t.slug}</code> · created {fmt(t.createdAt)}
        </span>
      </p>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-5">
          <Card>
            <CardTitle>Settings that differ from the defaults</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Overrides set for this tenant. Everything else follows the platform defaults.
            </p>
            <ul className="mt-4 grid gap-2">
              {(defs.data ?? [])
                .filter((d) => d.levels.includes('tenant'))
                .map((d) => {
                  const own = t.settingOverrides[d.key];
                  return (
                    <li
                      key={d.key}
                      className="flex items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-sm"
                    >
                      <div>
                        <div className="font-medium">{d.description}</div>
                        <div className="font-mono text-xs text-faint">{d.key}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {own !== undefined ? (
                          <Badge tone="accent">{String(own)}</Badge>
                        ) : (
                          <Badge>Default: {String(d.platformValue ?? d.default)}</Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEdit({ key: d.key, value: own !== undefined ? String(own) : '' })
                          }
                        >
                          Change
                        </Button>
                        {own !== undefined ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () => api.tenants.clearSetting(id, d.key),
                                'Back to the default',
                              )
                            }
                          >
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Card>
          <Card>
            <CardTitle>Companies</CardTitle>
            <ul className="mt-3 grid gap-2 text-sm">
              {t.entities.map((e) => (
                <li
                  key={e.id}
                  className="flex justify-between border-b border-line pb-2 last:border-0"
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="text-muted">{e.legalName}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="grid content-start gap-5">
          <Card>
            <CardTitle>Usage</CardTitle>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">Sign-in accounts</dt>
                <dd className="font-display text-3xl">{t.counts.users}</dd>
              </div>
              <div>
                <dt className="text-muted">People</dt>
                <dd className="font-display text-3xl">{t.counts.engagements}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardTitle>Audit trail</CardTitle>
            <p className="mt-2 text-sm">
              {t.auditChain.ok ? (
                <>
                  <Badge tone="success">Intact</Badge>{' '}
                  <span className="text-muted">{t.auditChain.checked} entries verified.</span>
                </>
              ) : (
                <>
                  <Badge tone="danger">Problem found</Badge>{' '}
                  <span className="text-muted">{t.auditChain.reason}</span>
                </>
              )}
            </p>
          </Card>
        </div>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent
          title={confirm === 'SUSPENDED' ? `Suspend ${t.name}?` : `Reactivate ${t.name}?`}
          description={
            confirm === 'SUSPENDED'
              ? 'Everyone in this company is signed out at once and cannot sign in until you reactivate it. Nothing is deleted.'
              : 'People can sign in again.'
          }
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={busy}
              variant={confirm === 'SUSPENDED' ? 'danger' : 'primary'}
              onClick={() =>
                confirm &&
                void act(
                  () => api.tenants.update(id, { status: confirm }),
                  confirm === 'SUSPENDED' ? 'Tenant suspended' : 'Tenant reactivated',
                  () => setConfirm(null),
                )
              }
            >
              {confirm === 'SUSPENDED' ? 'Suspend tenant' : 'Reactivate'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title="Change setting" description={edit?.key}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (edit)
                void act(
                  () => api.tenants.setSetting(id, edit.key, parseValue(edit.value)),
                  'Setting saved',
                  () => setEdit(null),
                );
            }}
          >
            <Field label="Value" htmlFor="sv">
              <Input
                id="sv"
                value={edit?.value ?? ''}
                onChange={(e) => edit && setEdit({ ...edit, value: e.target.value })}
                autoFocus
              />
            </Field>
            <Button type="submit" loading={busy} disabled={busy || !edit?.value.trim()}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
