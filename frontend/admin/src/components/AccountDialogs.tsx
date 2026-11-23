import {
  AccountPanel,
  Badge,
  Card,
  CardTitle,
  Dialog,
  DialogContent,
  Skeleton,
  Button,
  type AccountActionName,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';

const tone = { ACTIVE: 'success', INVITED: 'warning', DISABLED: 'danger' } as const;

/** One account in a dialog: for a company user, or (without tenantId) a member of platform staff. */
export function AccountDialog({
  tenantId,
  userId,
  open,
  onClose,
}: {
  tenantId?: string;
  userId: string;
  open: boolean;
  onClose: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const key = ['admin-account', tenantId ?? 'staff', userId];
  const q = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: () => (tenantId ? api.accounts.account(tenantId, userId) : api.accounts.staff(userId)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Account" className="max-w-xl">
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : q.isError ? (
          <p className="text-sm text-muted">{messageOf(q.error)}</p>
        ) : (
          <AccountPanel
            account={q.data}
            onAct={async (action: AccountActionName, reason: string) => {
              try {
                const r = tenantId
                  ? await api.accounts.act(tenantId, userId, action, reason)
                  : await api.accounts.staffAct(userId, action, reason);
                await qc.invalidateQueries({ queryKey: key });
                await qc.invalidateQueries({ queryKey: ['staff'] });
                await qc.invalidateQueries({ queryKey: ['admin-users', tenantId] });
                return r;
              } catch (e) {
                throw new Error(messageOf(e));
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A company's people accounts, each opening its account panel (needs the tenants.users.read power). */
export function TenantUsers({ tenantId }: { tenantId: string }) {
  const api = useApi();
  const can = useCan();
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin-users', tenantId],
    enabled: can('tenants.users.read'),
    queryFn: () => api.accounts.users(tenantId),
  });
  if (!can('tenants.users.read')) return null;
  return (
    <Card>
      <CardTitle>People accounts</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Sign-in accounts in this company. Open one to reset a password or two-step, unlock, suspend
        and more.
      </p>
      {list.isPending ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : list.data?.length ? (
        <ul className="mt-4 grid gap-2">
          {list.data.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{u.name ?? u.email}</span>
                {u.name ? <span className="ml-2 text-xs text-faint">{u.email}</span> : null}
              </span>
              <Badge tone={tone[u.status]}>{u.status.toLowerCase()}</Badge>
              <span className="text-xs text-faint">two-step {u.mfaEnabled ? 'on' : 'off'}</span>
              <Button size="sm" variant="secondary" onClick={() => setOpen(u.id)}>
                Account
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-faint">No accounts yet.</p>
      )}
      {open ? (
        <AccountDialog tenantId={tenantId} userId={open} open onClose={() => setOpen(null)} />
      ) : null}
    </Card>
  );
}
