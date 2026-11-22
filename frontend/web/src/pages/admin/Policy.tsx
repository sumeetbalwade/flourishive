import type { MfaLevel } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Field,
  Input,
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
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

const LEVELS: { value: MfaLevel; label: string }[] = [
  { value: 'OFF', label: 'Off' },
  { value: 'OPTIONAL', label: 'Optional' },
  { value: 'REQUIRED', label: 'Required' },
];
const RANK: Record<MfaLevel, number> = { OFF: 0, OPTIONAL: 1, REQUIRED: 2 };

/** Two-step sign-in and account recovery, role by role, within the floor the platform allows. */
export function Policy() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = auth.can('settings.manage');
  const q = useQuery({ queryKey: ['policies'], queryFn: () => api.access.policies() });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [level, setLevel] = useState<MfaLevel>('OPTIONAL');
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>, ok = 'Saved') {
    setBusy(true);
    try {
      await work();
      toast({ title: ok, tone: 'success' });
    } catch (err) {
      toast({ title: 'Not saved', description: messageOf(err), tone: 'danger' });
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ['policies'] });
      await qc.invalidateQueries({ queryKey: ['roles'] });
    }
  }

  return (
    <Layout
      active="policy"
      title="Security policy"
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add role
          </Button>
        ) : undefined
      }
    >
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Choose how each role signs in and recovers a lost account. A person with several roles gets
        the strictest two-step level among them. Some roles cannot go below a level set by the
        platform.
      </p>
      {q.isError ? (
        <EmptyState title="Could not load" description={messageOf(q.error)} />
      ) : q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card className="max-w-5xl p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Two-step sign-in</TH>
                  <TH>Email recovery</TH>
                  <TH>Recovery codes</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((p) => (
                  <TR key={p.roleKey}>
                    <TD>
                      <div className="font-medium">{p.name}</div>
                      {!p.isSystem && <Badge className="mt-1">Custom role</Badge>}
                      {RANK[p.mfaFloor] > 0 && (
                        <div className="mt-1 text-xs text-faint">
                          Platform minimum: {p.mfaFloor.toLowerCase()}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Segmented
                        label={`Two-step for ${p.name}`}
                        value={p.mfaLevel}
                        options={LEVELS.map((l) => ({
                          ...l,
                          disabled: !canEdit || busy || RANK[l.value] < RANK[p.mfaFloor],
                          title:
                            RANK[l.value] < RANK[p.mfaFloor]
                              ? 'Below the platform minimum'
                              : undefined,
                        }))}
                        onChange={(v) =>
                          void run(() => api.access.setPolicy(p.roleKey, { mfaLevel: v }))
                        }
                      />
                    </TD>
                    <TD>
                      <Switch
                        label={`Email recovery for ${p.name}`}
                        checked={p.recoveryEmail}
                        disabled={!canEdit || busy}
                        onChange={(v) =>
                          void run(() => api.access.setPolicy(p.roleKey, { recoveryEmail: v }))
                        }
                      />
                    </TD>
                    <TD>
                      <Switch
                        label={`Recovery codes for ${p.name}`}
                        checked={p.recoveryCodes}
                        disabled={!canEdit || busy}
                        onChange={(v) =>
                          void run(() => api.access.setPolicy(p.roleKey, { recoveryCodes: v }))
                        }
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="border-t border-line px-6 py-4 text-sm text-muted">
            <p>
              <b className="text-fg">Email recovery</b> lets people with this role reset a forgotten
              password or a lost authenticator with a code sent to their work email.{' '}
              <b className="text-fg">Recovery codes</b> are one-time codes handed out when two-step
              is set up. SMS recovery is not available yet.
            </p>
          </div>
        </Card>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent
          title="Add a role"
          description="A new role starts with sign-in access only. You can give it permissions later."
        >
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.access.createRole(name.trim(), level);
                setAdding(false);
                setName('');
              }, 'Role added');
            }}
          >
            <Field label="Role name" htmlFor="role-name">
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Finance reviewer"
                autoFocus
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium text-muted">Two-step sign-in</span>
              <Segmented
                label="Two-step for the new role"
                value={level}
                options={LEVELS}
                onChange={setLevel}
              />
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button type="submit" loading={busy} disabled={busy || name.trim().length < 2}>
                Add role
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
