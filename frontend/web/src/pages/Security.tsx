import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  useToast,
} from '@flourishive/ui';
import { useState } from 'react';
import { MfaEnrol } from '../components/MfaEnrol.tsx';
import { RecoveryCodes } from '../components/RecoveryCodes.tsx';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

export function Security() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const me = auth.state.status === 'authed' ? auth.state.me : null;
  const [enrolling, setEnrolling] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Layout active="security" title="My security">
      <div className="grid max-w-3xl gap-5">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Two-step sign-in</CardTitle>
              <p className="mt-2 text-sm text-muted">
                A code from your authenticator app, asked for each time you sign in.
              </p>
            </div>
            <Badge tone={me?.mfaEnabled ? 'success' : me?.mfaRequired ? 'danger' : 'neutral'}>
              {me?.mfaEnabled ? 'On' : 'Off'}
            </Badge>
          </div>
          {codes ? (
            <div className="mt-5">
              <RecoveryCodes
                codes={codes}
                onDone={() => {
                  setCodes(null);
                  setEnrolling(false);
                  void auth.reloadMe();
                }}
              />
            </div>
          ) : enrolling ? (
            <div className="mt-5">
              <MfaEnrol onDone={(c) => setCodes(c)} />
            </div>
          ) : !me?.mfaEnabled ? (
            <Button className="mt-4" onClick={() => setEnrolling(true)}>
              Turn on two-step sign-in
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted">
              It is on. If you lose your phone, sign in with a recovery code and ask HR to reset it.
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Your devices</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Signed in somewhere you no longer use? End every session, including this one.
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => setConfirmAll(true)}>
            Sign out everywhere
          </Button>
        </Card>

        <Card>
          <CardTitle>What you can do</CardTitle>
          <ul className="mt-3 flex flex-wrap gap-2">
            {me?.permissions.map((p) => (
              <Badge key={p}>{p}</Badge>
            ))}
          </ul>
        </Card>
      </div>

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent
          title="Sign out everywhere?"
          description="You will have to sign in again on every device, including this one."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.auth.logoutEverywhere();
                  go('/login');
                  window.location.reload();
                } catch (e) {
                  toast({ title: 'Could not sign out', description: messageOf(e), tone: 'danger' });
                  setBusy(false);
                }
              }}
            >
              Sign out everywhere
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
