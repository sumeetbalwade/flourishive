import type { LoginResponse } from '@flourishive/schemas';
import { Button, Card, Field, Input, brand } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Frame } from '../../components/Frame.tsx';
import { GoogleButton } from '../../components/GoogleButton.tsx';
import { MfaEnrol } from '../../components/MfaEnrol.tsx';
import { RecoveryCodes } from '../../components/RecoveryCodes.tsx';
import { useApi, remember } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { detectHere, useCompany } from '../../lib/company.ts';
import { messageOf } from '../../lib/errors.ts';
import { passkeysSupported, answerPasskey } from '../../lib/passkeys.ts';
import { go, useRoute } from '../../router.ts';

type Step =
  | { kind: 'credentials' }
  | { kind: 'mfa'; token: string; methods: { code: boolean; passkey: boolean } }
  | { kind: 'enrol'; token: string }
  | { kind: 'codes'; codes: string[] };

export function Login() {
  const api = useApi();
  const auth = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const detected = useMemo(detectHere, []);
  const [tenant, setTenant] = useState(detected.slug);
  // On a company's own address (<company>.<your domain>) the company is known, so nobody types a code.
  const fixed = detected.source === 'address';
  const company = useCompany(detected.slug);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish() {
    await auth.onSignedIn();
    go('/app/home');
  }

  async function handle(result: LoginResponse) {
    remember.set('fh.tenant', tenant.trim().toLowerCase());
    if (result.status === 'ok') return finish();
    setStep(
      result.status === 'mfa_required'
        ? {
            kind: 'mfa',
            token: result.mfaToken,
            methods: result.methods ?? { code: true, passkey: false },
          }
        : { kind: 'enrol', token: result.mfaToken },
    );
  }

  // Back from the company's single sign-on provider: swap the one-time ticket for a session.
  const route = useRoute();
  const ticket = route.path === '/sso' ? route.query.get('ticket') : null;
  const ssoError = route.query.get('sso_error');
  useEffect(() => {
    if (ssoError) setError(ssoError);
  }, [ssoError]);
  useEffect(() => {
    if (!ticket) return;
    setBusy(true);
    api.auth
      .ssoExchange(ticket)
      .then((r) => handle(r))
      .catch((e) => {
        setError(messageOf(e));
        go('/login');
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket]);
  const sso = useQuery({
    queryKey: ['sso-options', tenant.trim().toLowerCase()],
    queryFn: () => api.auth.ssoOptions(tenant.trim().toLowerCase()),
    enabled: tenant.trim().length > 1,
  });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === 'mfa')
    return (
      <MfaChallenge
        token={step.token}
        methods={step.methods}
        onDone={finish}
        onReenrol={(t) => setStep({ kind: 'enrol', token: t })}
        onBack={() => setStep({ kind: 'credentials' })}
      />
    );
  if (step.kind === 'enrol') {
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Set up two-step sign-in</h1>
          <p className="mt-2 text-sm text-muted">Your role requires it. It takes a minute.</p>
          <div className="mt-6">
            <MfaEnrol mfaToken={step.token} onDone={(codes) => setStep({ kind: 'codes', codes })} />
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
              doneLabel={`Continue to ${brand.appName}`}
            />
          </div>
        </Card>
      </Frame>
    );
  }

  if (fixed && company.status === 'missing')
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">We can’t find that company</h1>
          <p className="mt-3 text-sm text-muted">
            The address <b>{detected.slug}</b> is not in use, or the company is paused. Check the
            link you were given, or we can email you the right one.
          </p>
          <a href="#/find-company" className="mt-6 inline-block text-sm underline">
            Find my company
          </a>
        </Card>
      </Frame>
    );

  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Sign in</h1>
        {company.status === 'found' && (
          <p className="mt-1 text-sm text-muted">
            to <b className="text-fg">{company.company.name}</b>
          </p>
        )}
        <form
          className="mt-6 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const email = String(d.get('email') ?? '').trim();
            const password = String(d.get('password') ?? '');
            if (!tenant.trim() || !email || !password)
              return setError('Enter your company code, email and password.');
            void run(async () =>
              handle(
                await api.auth.login({ tenant: tenant.trim().toLowerCase(), email, password }),
              ),
            );
          }}
        >
          {!fixed && (
            <Field
              label="Company code"
              htmlFor="tenant"
              hint="The short name your HR team gave you, e.g. flourisense"
            >
              <Input
                id="tenant"
                name="tenant"
                autoComplete="organization"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
          )}
          <Field label="Work email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
            />
          </Field>
          <Field label="Password" htmlFor="password" error={error}>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </Field>
          <Button type="submit" size="lg" loading={busy} disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
          {passkeysSupported() ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() => {
                if (!tenant.trim()) return setError('Enter your company code first.');
                void run(async () => {
                  const slug = tenant.trim().toLowerCase();
                  const options = await api.auth.passkeyLoginOptions(slug);
                  const response = await answerPasskey(options);
                  await api.auth.passkeyLogin(slug, response);
                  remember.set('fh.tenant', slug);
                  await finish();
                });
              }}
            >
              Sign in with a passkey
            </Button>
          ) : null}
          {sso.data?.enabled ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  remember.set('fh.tenant', tenant.trim().toLowerCase());
                  const { url } = await api.auth.ssoStart(tenant.trim().toLowerCase());
                  window.location.assign(url);
                })
              }
            >
              Sign in with{' '}
              {sso.data.provider === 'MICROSOFT' ? 'Microsoft 365' : 'Google Workspace'}
            </Button>
          ) : null}
          <GoogleButton
            onError={setError}
            onCredential={(idToken) => {
              if (!tenant.trim()) return setError('Enter your company code first.');
              void run(async () =>
                handle(await api.auth.google(tenant.trim().toLowerCase(), idToken)),
              );
            }}
          />
          <a href="#/forgot-password" className="text-center text-sm text-muted underline">
            Forgot your password?
          </a>
          {!fixed && (
            <a href="#/find-company" className="text-center text-sm text-muted underline">
              Don’t know your company code?
            </a>
          )}
        </form>
      </Card>
      <p className="mt-6 text-center text-xs text-faint">
        <a href="#/design" className="underline">
          Design system
        </a>{' '}
        ·{' '}
        <a href="#/desktop" className="underline">
          Desktop app preview
        </a>
      </p>
    </Frame>
  );
}

function MfaChallenge({
  token,
  methods,
  onDone,
  onReenrol,
  onBack,
}: {
  token: string;
  methods: { code: boolean; passkey: boolean };
  onDone: () => Promise<void>;
  /** After an emailed code proves it is them: set up a new authenticator with this token. */
  onReenrol: (setupToken: string) => void;
  onBack: () => void;
}) {
  const api = useApi();
  const [useRecovery, setUseRecovery] = useState(false);
  const [emailMode, setEmailMode] = useState(false);
  const [remember, setRemember] = useState(false);
  const [byEmail, setByEmail] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = useRecovery && !emailMode ? code.trim().length >= 8 : code.length === 6;

  async function emailMe() {
    setBusy(true);
    setError('');
    try {
      await api.auth.mfaRecoveryStart(token);
      setByEmail(true);
      setCode('');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function viaPasskey() {
    setBusy(true);
    setError('');
    try {
      const options = await api.auth.mfaPasskeyOptions(token);
      await api.auth.mfaPasskeyVerify(token, await answerPasskey(options));
      await onDone();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  if (methods.passkey && !methods.code)
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Confirm with your passkey</h1>
          <p className="mt-2 text-sm text-muted">
            Use your fingerprint, face or screen lock to finish signing in.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button
            className="mt-6 w-full"
            size="lg"
            loading={busy}
            onClick={() => void viaPasskey()}
          >
            Use my passkey
          </Button>
          <button type="button" className="mt-4 text-sm text-faint underline" onClick={onBack}>
            Back to sign in
          </button>
        </Card>
      </Frame>
    );

  if (byEmail)
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
                onReenrol(r.mfaToken);
              } catch (err) {
                setError(messageOf(err));
                setBusy(false);
              }
            }}
          >
            <Field label="6-digit code" htmlFor="mr-code" error={error}>
              <Input
                id="mr-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                autoFocus
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
              onClick={() => setByEmail(false)}
            >
              Back
            </button>
          </form>
        </Card>
      </Frame>
    );

  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Two-step check</h1>
        <p className="mt-2 text-sm text-muted">
          {emailMode
            ? 'We emailed a 6-digit code to your account. Enter it here.'
            : useRecovery
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
                  : useRecovery
                    ? { mfaToken: token, recoveryCode: code.trim(), remember }
                    : { mfaToken: token, code, remember },
              );
              await onDone();
            } catch (err) {
              setError(messageOf(err));
              setBusy(false);
            }
          }}
        >
          <Field
            label={useRecovery ? 'Recovery code' : 'Authentication code'}
            htmlFor="otp"
            error={error}
          >
            <Input
              id="otp"
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={useRecovery ? 16 : 6}
              value={code}
              autoFocus
              onChange={(e) =>
                setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))
              }
              className={
                useRecovery ? 'font-mono' : 'text-center font-mono text-xl tracking-[0.5em]'
              }
              placeholder={useRecovery ? 'xxxxx-xxxxx' : '000000'}
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
          <button
            type="button"
            className="text-sm text-muted underline"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode('');
              setError('');
            }}
          >
            {useRecovery ? 'Use my authenticator app' : 'Lost your phone? Use a recovery code'}
          </button>
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
                  setUseRecovery(false);
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
            disabled={busy}
            onClick={() => void emailMe()}
          >
            No phone or codes? Email me a code to reset my authenticator
          </button>
          {methods.passkey ? (
            <button
              type="button"
              className="text-sm text-muted underline"
              disabled={busy}
              onClick={() => void viaPasskey()}
            >
              Use a passkey instead
            </button>
          ) : null}
          <button type="button" className="text-sm text-faint underline" onClick={onBack}>
            Back to sign in
          </button>
        </form>
      </Card>
    </Frame>
  );
}
