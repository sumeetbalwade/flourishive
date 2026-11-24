import { ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { Card, CardTitle } from './card.tsx';
import { Dialog, DialogContent } from './dialog.tsx';
import { Field, Input } from './input.tsx';
import { fmtDateTime } from '../format.ts';

export interface SecurityData {
  mfaEnabled: boolean;
  canDisableMfa: boolean;
  emailFallback: boolean;
  trustedDeviceDays: number;
  passkeys?: { id: string; label: string; createdAt: string; lastUsedAt: string }[];
  devices: {
    id: string;
    label: string;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
  }[];
}

const day = (iso: string) => fmtDateTime(iso);

/**
 * The parts of My security that follow the role's policy (D-64, D-65): remembered devices with revoke,
 * whether an emailed sign-in code is offered, and turning two-step off where that is allowed.
 */
export function SecurityExtras({
  info,
  onRevoke,
  onDisable,
}: {
  info: SecurityData;
  onRevoke: (id: string) => Promise<void>;
  /** Resolve when turned off; throw a readable error when the password was wrong. */
  onDisable: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Remembered devices</CardTitle>
            <p className="mt-2 text-sm text-muted">
              {info.trustedDeviceDays > 0
                ? `A device you chose to remember skips the two-step code for ${info.trustedDeviceDays} days.`
                : 'Remembering a device is turned off for your company.'}
            </p>
          </div>
          <Badge tone="neutral">{info.devices.length}</Badge>
        </div>
        {info.devices.length ? (
          <ul className="mt-4 grid gap-2">
            {info.devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line px-4 py-3 text-sm"
              >
                <span className="font-medium">{d.label}</span>
                <span className="text-xs text-faint">
                  added {day(d.createdAt)} · last used {day(d.lastUsedAt)} · until{' '}
                  {day(d.expiresAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => onRevoke(d.id)}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-faint">No remembered devices.</p>
        )}
        <p className="mt-4 text-xs text-muted">
          {info.emailFallback
            ? 'If you lose your phone you can ask for a sign-in code by email on the code screen.'
            : 'Signing in with an emailed code is not allowed for your role.'}
        </p>
      </Card>

      {info.mfaEnabled && info.canDisableMfa ? (
        <Card>
          <CardTitle>Turn off two-step</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Your role does not require it, so you may turn it off. Your account is then protected by
            your password alone.
          </p>
          <Button className="mt-4" variant="danger" onClick={() => setOpen(true)}>
            <ShieldOff size={15} /> Turn off two-step…
          </Button>
        </Card>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Turn off two-step?"
          description="Anyone who learns your password could sign in as you. Your remembered devices and recovery codes are removed. This is recorded in the audit log."
        >
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await onDisable(password);
                setOpen(false);
                setPassword('');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'That did not work');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="rounded-md border border-danger/40 bg-danger-lo px-4 py-3 text-sm text-danger">
              This makes your account easier to break into.
            </div>
            <Field
              label="Type your password to confirm"
              htmlFor="mfa-off-pw"
              error={error ?? undefined}
            >
              <Input
                id="mfa-off-pw"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={busy || password === ''}
            >
              Turn off two-step
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
