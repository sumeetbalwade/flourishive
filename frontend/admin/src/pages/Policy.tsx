import type { MfaLevel, PlatformRolePolicy } from '@flourishive/schemas';
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  Segmented,
  Skeleton,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

const LEVELS: { value: MfaLevel; label: string }[] = [
  { value: 'OFF', label: 'Off' },
  { value: 'OPTIONAL', label: 'Optional' },
  { value: 'REQUIRED', label: 'Required' },
];
const RANK: Record<MfaLevel, number> = { OFF: 0, OPTIONAL: 1, REQUIRED: 2 };

/** Two-step and recovery: for platform staff, and the default and floor for each company role. */
export function Policy() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const policies = useQuery({ queryKey: ['policies'], queryFn: () => api.policies.list() });
  const settings = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => api.settings.list(),
  });

  const staffMfa = settings.data?.find((s) => s.key === 'platform.superAdminMfa');
  const staffRecovery = settings.data?.find((s) => s.key === 'platform.superAdminRecoveryEmail');
  const mfaNow =
    ((staffMfa?.platformValue ?? staffMfa?.default) as MfaLevel | undefined) ?? 'REQUIRED';
  const recoveryNow = (staffRecovery?.platformValue ?? staffRecovery?.default) !== false;

  async function run(work: () => Promise<unknown>, key: 'policies' | 'platform-settings') {
    try {
      await work();
      toast({ title: 'Saved', tone: 'success' });
    } catch (err) {
      toast({ title: 'Not saved', description: messageOf(err), tone: 'danger' });
    } finally {
      await qc.invalidateQueries({ queryKey: [key] });
    }
  }
  const changeRole = (roleKey: string, patch: Partial<PlatformRolePolicy>) =>
    run(() => api.policies.set(roleKey, patch), 'policies');
  const changeStaff = (key: string, value: unknown) =>
    run(() => api.settings.set(key, { value }), 'platform-settings');

  return (
    <Layout active="policy" title="Security policy">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Two-step sign-in and account recovery. For company roles you set the starting level and the
        floor: a company can raise a role above its floor, never below it.
      </p>

      <div className="grid max-w-5xl gap-6">
        <Card>
          <CardTitle>Platform staff (super admins)</CardTitle>
          {settings.isPending ? (
            <Skeleton className="mt-4 h-16 w-full" />
          ) : (
            <div className="mt-4 grid gap-4">
              {mfaNow === 'OFF' && (
                <div className="flex gap-3 rounded-card bg-danger-lo p-4 text-sm">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
                  <p>
                    <b className="text-danger">Two-step is off for platform staff.</b> A stolen
                    password would give full platform access.
                  </p>
                </div>
              )}
              {!recoveryNow && (
                <div className="flex gap-3 rounded-card bg-warning-lo p-4 text-sm">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
                  <p>
                    <b className="text-warning">Email recovery is off for platform staff.</b> A
                    locked-out super admin could only be restored by hand in the database.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Two-step sign-in</div>
                  <div className="text-sm text-muted">
                    Anyone already enrolled is still asked for a code.
                  </div>
                </div>
                <Segmented
                  label="Two-step for platform staff"
                  value={mfaNow}
                  options={LEVELS}
                  onChange={(v) => void changeStaff('platform.superAdminMfa', v)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Recovery by emailed code</div>
                  <div className="text-sm text-muted">
                    For a lost authenticator or forgotten password.
                  </div>
                </div>
                <Switch
                  label="Email recovery for platform staff"
                  checked={recoveryNow}
                  onChange={(v) => void changeStaff('platform.superAdminRecoveryEmail', v)}
                />
              </div>
            </div>
          )}
        </Card>

        <Card className="p-0">
          <div className="px-6 pt-6">
            <CardTitle>Company roles</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Starting policy for every company. Companies can add their own roles; those can be set
              to any level.
            </p>
          </div>
          {policies.isError ? (
            <EmptyState title="Could not load" description={messageOf(policies.error)} />
          ) : policies.isPending ? (
            <Skeleton className="m-6 h-40" />
          ) : (
            <div className="mt-4 overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Role</TH>
                    <TH>Default two-step</TH>
                    <TH>Floor</TH>
                    <TH>Email recovery</TH>
                    <TH>Recovery codes</TH>
                  </TR>
                </THead>
                <TBody>
                  {policies.data.map((p) => (
                    <TR key={p.roleKey}>
                      <TD className="font-medium">{p.name}</TD>
                      <TD>
                        <Segmented
                          label={`Default two-step for ${p.name}`}
                          value={p.mfaLevel}
                          options={LEVELS.map((l) => ({
                            ...l,
                            disabled: RANK[l.value] < RANK[p.mfaFloor],
                            title: RANK[l.value] < RANK[p.mfaFloor] ? 'Below the floor' : undefined,
                          }))}
                          onChange={(v) => void changeRole(p.roleKey, { mfaLevel: v })}
                        />
                      </TD>
                      <TD>
                        <Segmented
                          label={`Floor for ${p.name}`}
                          value={p.mfaFloor}
                          options={LEVELS.map((l) => ({
                            ...l,
                            disabled: RANK[l.value] > RANK[p.mfaLevel],
                            title:
                              RANK[l.value] > RANK[p.mfaLevel]
                                ? 'Raise the default first'
                                : undefined,
                          }))}
                          onChange={(v) => void changeRole(p.roleKey, { mfaFloor: v })}
                        />
                      </TD>
                      <TD>
                        <Switch
                          label={`Email recovery for ${p.name}`}
                          checked={p.recoveryEmail}
                          onChange={(v) => void changeRole(p.roleKey, { recoveryEmail: v })}
                        />
                      </TD>
                      <TD>
                        <Switch
                          label={`Recovery codes for ${p.name}`}
                          checked={p.recoveryCodes}
                          onChange={(v) => void changeRole(p.roleKey, { recoveryCodes: v })}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          <div className="px-6 pb-5 pt-3">
            <Badge>SMS recovery is not available yet. It needs DLT registration.</Badge>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
