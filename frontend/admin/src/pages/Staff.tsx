import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
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
import { AccountDialog } from '../components/AccountDialogs.tsx';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';
import { fmtDateTime } from '@flourishive/ui';

const tone = { ACTIVE: 'success', INVITED: 'warning', DISABLED: 'danger' } as const;
const when = (iso: string | null) => (iso ? fmtDateTime(iso) : 'Never');

export function Staff() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['staff'], queryFn: () => api.staff.list() });
  const [open, setOpen] = useState(false);
  const roles = useQuery({ queryKey: ['platform-roles'], queryFn: () => api.roles.list() });
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [accountOf, setAccountOf] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = auth.state.status === 'authed' ? auth.state.email : '';

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['staff'] });
    } catch (e) {
      toast({ title: 'That did not work', description: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      active="users"
      title="Platform users"
      actions={
        <Button
          size="sm"
          onClick={() => {
            setOpen(true);
            setLink(null);
            setEmail('');
            setRoleId(roles.data?.roles.find((r) => r.key === 'support')?.id ?? '');
          }}
        >
          <Plus size={16} /> Invite
        </Button>
      }
    >
      {list.isError ? (
        <EmptyState title="Could not load" description={messageOf(list.error)} />
      ) : list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Two-step</TH>
              <TH>Last sign-in</TH>
              <TH className="w-32" />
            </TR>
          </THead>
          <TBody>
            {list.data.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">
                  {u.email}
                  {u.email === me ? <span className="ml-2 text-xs text-faint">(you)</span> : null}
                </TD>
                <TD className="min-w-48">
                  <Select
                    value={u.role.id}
                    onValueChange={(rid) =>
                      void run(
                        () => api.roles.assign(u.id, rid),
                        `${u.email} is now ${roles.data?.roles.find((r) => r.id === rid)?.name ?? 'updated'}`,
                      )
                    }
                    options={(roles.data?.roles ?? [u.role]).map((r) => ({
                      value: r.id,
                      label: r.name,
                    }))}
                    className={busy ? 'pointer-events-none opacity-50' : undefined}
                  />
                </TD>
                <TD>
                  <Badge tone={tone[u.status]}>
                    {u.status.charAt(0) + u.status.slice(1).toLowerCase()}
                  </Badge>
                </TD>
                <TD>{u.mfaEnabledAt ? 'On' : '—'}</TD>
                <TD className="text-muted">{when(u.lastLoginAt)}</TD>
                <TD className="text-right">
                  {u.email !== me ? (
                    <Button size="sm" variant="secondary" onClick={() => setAccountOf(u.id)}>
                      Account
                    </Button>
                  ) : null}
                  {u.status === 'ACTIVE' && u.email !== me ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.staff.setStatus(u.id, 'DISABLED'), `${u.email} disabled`)
                      }
                    >
                      Disable
                    </Button>
                  ) : null}
                  {u.status === 'DISABLED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.staff.setStatus(u.id, 'ACTIVE'), `${u.email} enabled`)
                      }
                    >
                      Enable
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {accountOf ? (
        <AccountDialog userId={accountOf} open onClose={() => setAccountOf(null)} />
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Invite staff"
          description="They get an email to choose a password and set up two-step sign-in."
        >
          {link ? (
            <div className="grid gap-3 text-sm">
              <p>
                Invitation created. If the email does not arrive, give them this link (valid 7
                days):
              </p>
              <code className="break-all rounded-md bg-surface-2 p-2 font-mono text-xs">
                {link}
              </code>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const r = await api.staff.invite(email.trim(), roleId);
                  setLink(r.link);
                  await qc.invalidateQueries({ queryKey: ['staff'] });
                } catch (err) {
                  toast({ title: 'Could not invite', description: messageOf(err), tone: 'danger' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label="Role"
                htmlFor="inv-role"
                hint="What they can do. You can change it later."
              >
                <Select
                  id="inv-role"
                  value={roleId}
                  onValueChange={setRoleId}
                  placeholder="Choose a role"
                  options={(roles.data?.roles ?? []).map((r) => ({ value: r.id, label: r.name }))}
                />
              </Field>
              <Field label="Email" htmlFor="inv">
                <Input
                  id="inv"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </Field>
              <Button type="submit" loading={busy} disabled={busy || !email.trim() || !roleId}>
                Send invitation
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
