import { Button, Field, Input } from '@flourishive/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';

/** Staff must use an authenticator app. Scan the code, then prove it works with a first code. */
export function Enrol({
  mfaToken,
  onDone,
}: {
  mfaToken: string;
  onDone: (recoveryCodes: string[]) => void;
}) {
  const api = useApi();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // once only: a second call would replace the secret being scanned
    started.current = true;
    api.auth.mfaSetup(mfaToken).then(setSetup, (e) => setError(messageOf(e)));
  }, [api, mfaToken]);

  if (!setup) return <p className="text-sm text-muted">{error || 'Preparing…'}</p>;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          onDone((await api.auth.mfaConfirm(mfaToken, code)).recoveryCodes);
        } catch (err) {
          setError(messageOf(err));
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">
        Scan this with an authenticator app, then enter the 6-digit code it shows.
      </p>
      <div className="mx-auto rounded-card bg-white p-3">
        <QRCodeSVG value={setup.otpauthUri} size={168} title="Authenticator setup code" />
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Cannot scan? Enter the key by hand</summary>
        <code className="mt-2 block break-all rounded-md bg-surface-2 p-2 font-mono">
          {setup.secret}
        </code>
      </details>
      <Field label="Code from the app" htmlFor="enrol-code" error={error}>
        <Input
          id="enrol-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="text-center font-mono text-xl tracking-[0.5em]"
          placeholder="000000"
        />
      </Field>
      <Button type="submit" size="lg" disabled={code.length !== 6 || busy}>
        {busy ? 'Checking…' : 'Turn on two-step sign-in'}
      </Button>
    </form>
  );
}
