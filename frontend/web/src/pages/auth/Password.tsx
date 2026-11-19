import { Button, Card, Field, Input } from '@flourishive/ui';
import { useState } from 'react';
import { Frame } from '../../components/Frame.tsx';
import { useApi, remember } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';

export function ForgotPassword() {
  const api = useApi();
  const [tenant, setTenant] = useState(() => remember.get('fh.tenant'));
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (sent) {
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Check your email</h1>
          <p className="mt-3 text-sm text-muted">
            If that address has an account, a link to choose a new password is on its way. It works
            for one hour.
          </p>
          <Button
            className="mt-6 w-full"
            size="lg"
            variant="secondary"
            onClick={() => go('/login')}
          >
            Back to sign in
          </Button>
        </Card>
      </Frame>
    );
  }
  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Forgot password</h1>
        <form
          className="mt-6 grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
            if (!tenant.trim() || !email) return setError('Enter your company code and email.');
            setBusy(true);
            setError('');
            try {
              await api.auth.forgotPassword(tenant.trim().toLowerCase(), email);
              setSent(true);
            } catch (err) {
              setError(messageOf(err));
              setBusy(false);
            }
          }}
        >
          <Field label="Company code" htmlFor="f-tenant">
            <Input
              id="f-tenant"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Field label="Work email" htmlFor="f-email" error={error}>
            <Input id="f-email" name="email" type="email" autoComplete="username" />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
          <a href="#/login" className="text-center text-sm text-muted underline">
            Back to sign in
          </a>
        </form>
      </Card>
    </Frame>
  );
}

/** Also used for the first password after an invite: both arrive as a link with a token. */
export function ResetPassword({ token }: { token: string }) {
  const api = useApi();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Link not valid</h1>
          <p className="mt-3 text-sm text-muted">
            This link is incomplete. Open the link from your email again, or ask for a new one.
          </p>
          <a href="#/forgot-password" className="mt-4 inline-block text-sm underline">
            Send me a new link
          </a>
        </Card>
      </Frame>
    );
  }
  if (done) {
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Password saved</h1>
          <p className="mt-3 text-sm text-muted">You can sign in with your new password now.</p>
          <Button className="mt-6 w-full" size="lg" onClick={() => go('/login')}>
            Sign in
          </Button>
        </Card>
      </Frame>
    );
  }
  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Choose a password</h1>
        <form
          className="mt-6 grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const password = String(d.get('password') ?? '');
            if (password !== String(d.get('confirm') ?? ''))
              return setError('The two passwords do not match.');
            setBusy(true);
            setError('');
            try {
              await api.auth.resetPassword(token, password);
              setDone(true);
            } catch (err) {
              setError(messageOf(err));
              setBusy(false);
            }
          }}
        >
          <Field
            label="New password"
            htmlFor="np"
            hint="At least 12 characters. A few random words is a good choice."
          >
            <Input id="np" name="password" type="password" autoComplete="new-password" />
          </Field>
          <Field label="Repeat password" htmlFor="np2" error={error}>
            <Input id="np2" name="confirm" type="password" autoComplete="new-password" />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </Button>
        </form>
      </Card>
    </Frame>
  );
}
