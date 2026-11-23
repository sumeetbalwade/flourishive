import { Button, Card, Field, Input } from '@flourishive/ui';
import { useState } from 'react';
import { Enrol } from '../components/Enrol.tsx';
import { Frame } from '../components/Frame.tsx';
import { RecoveryCodes } from '../components/RecoveryCodes.tsx';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';

type Step =
  | { kind: 'credentials' }
  | { kind: 'mfa'; token: string }
  | { kind: 'enrol'; token: string }
  | { kind: 'email'; token: string }
  | { kind: 'codes'; codes: string[] };

export function Login() {
  const api = useApi();
  const auth = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [emailMode, setEmailMode] = useState(false);
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState('');

  const finish = async () => {
    await auth.onSignedIn();
    go('/tenants');
  };

  if (step.kind === 'enrol') {
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Set up two-step sign-in</h1>
          <p className="mt-2 text-sm text-muted">
            Required for everyone with access to the console.
          </p>
          <div className="mt-6">
            <Enrol mfaToken={step.token} onDone={(codes) => setStep({ kind: 'codes', codes })} />
          </div>
        </Card>
      </Frame>
    );
  }
  if (step.kind === 'codes') {
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Recovery codes</h1>
          <div className="mt-4">
            <RecoveryCodes
              codes={step.codes}
              onDone={() => void finish()}
              doneLabel="Open the console"
            />
          </div>
        </Card>
      </Frame>
    );
  }
  if (step.kind === 'email') {
    const token = step.token;
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Check your email</h1>
          <p className="mt-2 text-sm text-muted">
            We emailed a 6-digit code to your account. Enter it to remove your old authenticator and
            set up a new one.
          </p>
          <form
            className="mt-6 grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const r = await api.auth.mfaRecoveryVerify(token, code);
                setCode('');
                setStep({ kind: 'enrol', token: r.mfaToken });
              } catch (err) {
                setError(messageOf(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="6-digit code" htmlFor="mr-code" error={error}>
              <Input
                id="mr-code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="text-center font-mono text-xl tracking-[0.5em]"
                placeholder="000000"
              />
            </Field>
            <Button type="submit" size="lg" loading={busy} disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Verify and set up again'}
            </Button>
            <button
              type="button"
              className="text-sm text-muted underline"
              onClick={() => setStep({ kind: 'mfa', token })}
            >
              Back
            </button>
          </form>
        </Card>
      </Frame>
    );
  }
  if (step.kind === 'mfa') {
    const token = step.token;
    const ready = recovery && !emailMode ? code.trim().length >= 8 : code.length === 6;
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Two-step check</h1>
          <p className="mt-2 text-sm text-muted">
            {emailMode
              ? 'We emailed a 6-digit code to your account. Enter it here.'
              : recovery
                ? 'Enter one of your recovery codes.'
                : 'Enter the 6-digit code from your authenticator app.'}
          </p>
          <form
            className="mt-6 grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api.auth.mfaVerify(
                  emailMode
                    ? { mfaToken: token, emailCode: code, remember }
                    : recovery
                      ? { mfaToken: token, recoveryCode: code.trim(), remember }
                      : { mfaToken: token, code, remember },
                );
                await finish();
              } catch (err) {
                setError(messageOf(err));
                setBusy(false);
              }
            }}
          >
            <Field
              label={recovery ? 'Recovery code' : 'Authentication code'}
              htmlFor="otp"
              error={error}
            >
              <Input
                id="otp"
                autoFocus
                inputMode={recovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={recovery ? 16 : 6}
                value={code}
                onChange={(e) =>
                  setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, ''))
                }
                className={
                  recovery ? 'font-mono' : 'text-center font-mono text-xl tracking-[0.5em]'
                }
                placeholder={recovery ? 'xxxxx-xxxxx' : '000000'}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Remember this device (skip the code here for a while)
            </label>
            <Button type="submit" size="lg" disabled={!ready || busy}>
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            {!emailMode ? (
              <button
                type="button"
                className="text-sm text-muted underline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api.auth.mfaEmailCode(token);
                    setEmailMode(true);
                    setRecovery(false);
                    setCode('');
                  } catch (err) {
                    setError(messageOf(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Email me a sign-in code instead
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm text-muted underline"
              onClick={() => {
                setRecovery(!recovery);
                setCode('');
                setError('');
              }}
            >
              {recovery ? 'Use my authenticator app' : 'Lost your phone? Use a recovery code'}
            </button>
            <button
              type="button"
              className="text-sm text-muted underline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api.auth.mfaRecoveryStart(token);
                  setCode('');
                  setStep({ kind: 'email', token });
                } catch (err) {
                  setError(messageOf(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              No phone or codes? Email me a code to reset my authenticator
            </button>
          </form>
        </Card>
      </Frame>
    );
  }

  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Admin sign in</h1>
        <form
          className="mt-6 grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const email = String(d.get('email') ?? '').trim();
            const password = String(d.get('password') ?? '');
            if (!email || !password) return setError('Enter your email and password.');
            setBusy(true);
            setError('');
            try {
              const r = await api.auth.login(email, password);
              setCode('');
              // The platform policy may let staff in on the password alone.
              if (r.status === 'ok' || !r.mfaToken) {
                await finish();
                return;
              }
              setStep(
                r.status === 'mfa_required'
                  ? { kind: 'mfa', token: r.mfaToken }
                  : { kind: 'enrol', token: r.mfaToken },
              );
              setBusy(false);
            } catch (err) {
              setError(messageOf(err));
              setBusy(false);
            }
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" />
          </Field>
          <Field label="Password" htmlFor="password" error={error}>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </Field>
          <Button type="submit" size="lg" loading={busy} disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
        </form>
      </Card>
    </Frame>
  );
}

/** First password for invited staff (the link in their invite email). */
export function SetPassword({ token }: { token: string }) {
  const api = useApi();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!token)
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Link not valid</h1>
          <p className="mt-3 text-sm text-muted">
            Open the link from your invitation email again, or ask for a new invitation.
          </p>
        </Card>
      </Frame>
    );
  if (done)
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Password saved</h1>
          <Button className="mt-6 w-full" size="lg" onClick={() => go('/login')}>
            Sign in
          </Button>
        </Card>
      </Frame>
    );
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
              await api.auth.setPassword(token, password);
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
            hint="At least 14 characters for console accounts."
          >
            <Input id="np" name="password" type="password" autoComplete="new-password" />
          </Field>
          <Field label="Repeat password" htmlFor="np2" error={error}>
            <Input id="np2" name="confirm" type="password" autoComplete="new-password" />
          </Field>
          <Button type="submit" size="lg" loading={busy} disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </Button>
        </form>
      </Card>
    </Frame>
  );
}
