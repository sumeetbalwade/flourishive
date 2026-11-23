import { ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { cn } from '../cn.ts';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { Dialog, DialogContent } from './dialog.tsx';
import { Field } from './input.tsx';
import { item as menuItem, panel as menuPanel } from './popover-styles.ts';

export type AccountActionName =
  | 'reset-password'
  | 'reset-mfa'
  | 'unlock'
  | 'sign-out-everywhere'
  | 'suspend'
  | 'reactivate'
  | 'resend-invite';

export interface AccountInfo {
  email: string;
  name: string | null;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  trustedDevices: number;
  roles: string[];
  allowed: AccountActionName[];
}

const COPY: Record<AccountActionName, { label: string; what: string; danger?: boolean }> = {
  'reset-password': {
    label: 'Reset password',
    what: 'Signs them out everywhere and emails them a link to choose a new password. Nobody sees or sets the password.',
  },
  'reset-mfa': {
    label: 'Reset two-step',
    what: 'Removes their authenticator, recovery codes and remembered devices. They set it up again at next sign-in if their role needs it.',
  },
  unlock: {
    label: 'Unlock',
    what: 'Clears the failed sign-in counters so they can try again right away.',
  },
  'sign-out-everywhere': {
    label: 'Sign out everywhere',
    what: 'Ends every sign-in they have on any device.',
  },
  suspend: {
    label: 'Suspend',
    what: 'Stops them signing in and ends their sign-ins now. You can reactivate later.',
    danger: true,
  },
  reactivate: { label: 'Reactivate', what: 'Lets them sign in again.' },
  'resend-invite': {
    label: 'Resend invitation',
    what: 'Emails the invitation to choose a password again.',
  },
};

const tone = { ACTIVE: 'success', INVITED: 'warning', DISABLED: 'danger' } as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN') : 'Never');

/**
 * One account at a glance with an Actions menu (D-63). Every action asks for a reason; the person is
 * emailed what was done and by whom. The caller supplies `onAct`, which also handles "confirm it is you".
 */
export function AccountPanel({
  account,
  onAct,
  className,
}: {
  account: AccountInfo;
  onAct: (
    action: AccountActionName,
    reason: string,
  ) => Promise<{ link?: string; emailed?: boolean } | void>;
  className?: string;
}) {
  const [chosen, setChosen] = useState<AccountActionName | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function confirm() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onAct(chosen, reason.trim());
      if (r && r.link && r.emailed === false) setLink(r.link);
      else setChosen(null);
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  const info = COPY[chosen ?? 'unlock'];
  return (
    <div className={cn('grid gap-4', className)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{account.name ?? account.email}</p>
          {account.name ? <p className="truncate text-sm text-muted">{account.email}</p> : null}
        </div>
        <Badge tone={tone[account.status]}>
          {account.status.charAt(0) + account.status.slice(1).toLowerCase()}
        </Badge>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="secondary" disabled={account.allowed.length === 0}>
              Actions <ChevronDown size={14} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className={cn(menuPanel, 'min-w-56')}>
              {account.allowed.map((a) => (
                <DropdownMenu.Item
                  key={a}
                  onSelect={() => {
                    setChosen(a);
                    setReason('');
                    setError(null);
                    setLink(null);
                  }}
                  className={cn(menuItem, COPY[a].danger && 'text-danger')}
                >
                  {COPY[a].label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted">Last sign-in</dt>
        <dd>{when(account.lastLoginAt)}</dd>
        <dt className="text-muted">Two-step</dt>
        <dd>
          {account.mfaEnabled ? 'On' : 'Off'}
          {account.mfaRequired ? ' (required for their role)' : ''}
        </dd>
        <dt className="text-muted">Remembered devices</dt>
        <dd>{account.trustedDevices}</dd>
        <dt className="text-muted">Roles</dt>
        <dd>{account.roles.length ? account.roles.join(', ') : '—'}</dd>
      </dl>
      {account.allowed.length === 0 ? (
        <p className="text-xs text-faint">
          No actions available here: it is your own account, or this person can do things you
          cannot, or nothing applies to the account’s state.
        </p>
      ) : null}

      <Dialog open={chosen !== null} onOpenChange={(o) => !o && setChosen(null)}>
        <DialogContent title={`${info.label}: ${account.email}`} description={info.what}>
          {link ? (
            <div className="grid gap-3 text-sm">
              <p>The email could not be sent. Give them this link instead:</p>
              <code className="break-all rounded-md bg-surface-2 p-2 font-mono text-xs">
                {link}
              </code>
              <Button variant="secondary" onClick={() => setChosen(null)}>
                Done
              </Button>
            </div>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              <Field
                label="Why are you doing this?"
                htmlFor="acct-reason"
                hint="Kept in the audit log. They are emailed what was done and by whom."
                error={error ?? undefined}
              >
                <textarea
                  id="acct-reason"
                  autoFocus
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-card border border-line-strong bg-surface px-4 py-3 text-sm focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)]"
                />
              </Field>
              <Button
                type="submit"
                variant={info.danger ? 'danger' : 'primary'}
                loading={busy}
                disabled={busy || reason.trim().length < 5}
              >
                {info.label}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
