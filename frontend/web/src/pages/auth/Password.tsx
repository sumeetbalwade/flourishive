import { Button, Card, Field, Input } from '@flourishive/ui';
import { useState } from 'react';
import { Frame } from '../../components/Frame.tsx';
import { useApi } from '../../lib/api.tsx';
import { detectHere } from '../../lib/company.ts';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';

type Step = 'email' | 'code' | 'password' | 'done';

/** Forgot password: email -> 6-digit code from the inbox -> new password. */
export function ForgotPassword() {
  const api = useApi();
  const detected = detectHere();
  const [tenant, setTenant] = useState(detected.slug);
  const fixed = detected.source === 'address';
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const company = tenant.trim().toLowerCase();

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done')
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

  if (step === 'password')
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Choose a new password</h1>
          <form
            className="mt-6 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const password = String(d.get('password') ?? '');
              if (password !== String(d.get('confirm') ?? ''))
                return setError('The two passwords do not match.');
              void run(async () => {
                await api.auth.resetPassword(resetToken, password);
                setStep('done');
              });
            }}
          >
            <Field
              label="New password"
              htmlFor="fp-new"
              hint="At least 12 characters. A few random words is a good choice."
            >
              <Input
                id="fp-new"
                name="password"
                type="password"
                autoComplete="new-password"
                autoFocus
              />
            </Field>
            <Field label="Repeat password" htmlFor="fp-new2" error={error}>
              <Input id="fp-new2" name="confirm" type="password" autoComplete="new-password" />
            </Field>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Saving…' : 'Save password'}
            </Button>
          </form>
        </Card>
      </Frame>
    );

  if (step === 'code')
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Enter the code</h1>
          <p className="mt-2 text-sm text-muted">
            If <b className="text-fg">{email}</b> has an account, we have emailed it a 6-digit code.
            It works once and expires soon.
          </p>
          <form
            className="mt-6 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api.auth.recoveryVerify(company, email, code);
                setResetToken(r.resetToken);
                setStep('password');
              });
            }}
          >
            <Field label="6-digit code" htmlFor="fp-code" error={error}>
              <Input
                id="fp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                autoFocus
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Continue'}
            </Button>
            <button
              type="button"
              className="text-center text-sm text-muted underline"
              onClick={() => void run(() => api.auth.recoveryStart(company, email))}
            >
              Send a new code
            </button>
            <p className="text-center text-xs text-faint">
              Nothing arrived? Your role may not allow email recovery. Ask your administrator.
            </p>
          </form>
        </Card>
      </Frame>
    );

  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Forgot password</h1>
        <p className="mt-2 text-sm text-muted">We will email you a 6-digit code.</p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const typed = String(new FormData(e.currentTarget).get('email') ?? '').trim();
            if (!company || !typed) return setError('Enter your company code and email.');
            void run(async () => {
              await api.auth.recoveryStart(company, typed);
              setEmail(typed);
              setCode('');
              setStep('code');
            });
          }}
        >
          {!fixed && (
            <Field label="Company code" htmlFor="f-tenant">
              <Input
                id="f-tenant"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
          )}
          <Field label="Work email" htmlFor="f-email" error={error}>
            <Input id="f-email" name="email" type="email" autoComplete="username" />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a code'}
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
