import type { AcceptInfo } from '@flourishive/schemas';
import { Button, Card, Field, Input, SigningAnimation, Skeleton } from '@flourishive/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiProblem, acceptApi } from '../api.ts';

type Step = 'review' | 'code' | 'done' | 'declined';
const date = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(
    new Date(iso),
  );

const CLOSED: Record<string, string> = {
  COMPLETED: 'This document has already been accepted. Thank you.',
  DECLINED: 'This request was declined.',
  EXPIRED: 'This link has expired. Ask the company to send a new one.',
  CANCELLED:
    'The company cancelled this request. Ask them to send a new one if you still need to accept.',
};

export function Accept({ token }: { token: string }) {
  const [info, setInfo] = useState<AcceptInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<Step>('review');

  useEffect(() => {
    let live = true;
    acceptApi.info(token).then(
      (v) => live && setInfo(v),
      (e: unknown) => live && setMissing(e instanceof ApiProblem ? e.status === 404 : true),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (missing)
    return (
      <Card className="grid gap-2 p-8 text-center">
        <h1 className="font-display text-3xl">Link not found</h1>
        <p className="text-sm text-muted">
          This link is not valid. Open the link from your email again, or ask the company to send a
          new one.
        </p>
      </Card>
    );
  if (!info)
    return (
      <Card className="grid gap-3 p-8">
        <Skeleton className="h-8" />
        <Skeleton className="h-40" />
      </Card>
    );

  if (step === 'done')
    return (
      <Card className="grid justify-items-center gap-4 p-10 text-center">
        <SigningAnimation state="done" size={110} />
        <h1 className="font-display text-3xl">Accepted</h1>
        <p className="text-sm text-muted">
          Your acceptance of {info.reference} is recorded and the document is sealed. A confirmation
          was sent to {info.emailHint}.
        </p>
        <a
          className="text-sm text-accent-hi underline"
          href={acceptApi.documentUrl(token)}
          target="_blank"
          rel="noreferrer"
        >
          Download your sealed copy
        </a>
      </Card>
    );
  if (step === 'declined')
    return (
      <Card className="grid gap-2 p-8 text-center">
        <h1 className="font-display text-3xl">Declined</h1>
        <p className="text-sm text-muted">
          The company has been told you declined. You can close this page.
        </p>
      </Card>
    );
  if (!info.canAccept)
    return (
      <Card className="grid gap-2 p-8 text-center">
        <h1 className="font-display text-3xl">{info.reference}</h1>
        <p className="text-sm text-muted">{CLOSED[info.status] ?? 'This request is closed.'}</p>
      </Card>
    );

  return (
    <div className="grid gap-5">
      <Card className="grid gap-4 p-6">
        <div className="grid gap-1">
          <p className="text-xs uppercase tracking-wide text-faint">From {info.issuedBy}</p>
          <h1 className="font-display text-3xl">Please review {info.reference}</h1>
          <p className="text-sm text-muted">
            Hello {info.name}. Read the document, then{' '}
            {info.method === 'AADHAAR'
              ? 'sign it with your Aadhaar'
              : `confirm with a code we send to ${info.emailHint}`}
            . This link works until {date(info.expiresAt)}.
          </p>
        </div>
        <iframe
          title="Document"
          src={acceptApi.documentUrl(token)}
          className="h-[28rem] w-full rounded-md border border-line bg-white"
        />
        <a
          className="text-sm text-accent-hi underline"
          href={acceptApi.documentUrl(token)}
          target="_blank"
          rel="noreferrer"
        >
          Open the document in a new tab
        </a>
      </Card>
      {info.method === 'AADHAAR' ? (
        step !== 'done' && step !== 'declined' ? (
          <Esign
            token={token}
            onDone={() => setStep('done')}
            onDeclined={() => setStep('declined')}
          />
        ) : null
      ) : (
        <>
          {step === 'review' ? <Ask token={token} onSent={() => setStep('code')} /> : null}
          {step === 'code' ? <Confirm token={token} onDone={() => setStep('done')} /> : null}
        </>
      )}
      <Decline token={token} onDone={() => setStep('declined')} />
    </div>
  );
}

/** Aadhaar eSign: go to the provider, and finish when they send the browser back with ?esign=<trip>. */
function Esign({
  token,
  onDone,
  onDeclined,
}: {
  token: string;
  onDone: () => void;
  onDeclined: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const txn = new URLSearchParams(location.search).get('esign');

  useEffect(() => {
    if (!txn) return;
    let live = true;
    setBusy(true);
    acceptApi.completeEsign(token, txn).then(
      (r) => {
        if (!live) return;
        history.replaceState(null, '', location.pathname);
        if (r.accepted) onDone();
        else {
          setBusy(false);
          setError(r.message ?? 'Signing was not completed.');
          if (r.message?.includes('declined')) onDeclined();
        }
      },
      (e: unknown) => {
        if (!live) return;
        setBusy(false);
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      },
    );
    return () => {
      live = false;
    };
  }, [token, txn, onDone, onDeclined]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const r = await acceptApi.startEsign(token);
      location.href = r.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  }
  return (
    <Card className="grid gap-3 p-6">
      <p className="text-sm text-muted">
        When you have read the document, sign it with your Aadhaar. You will go to the signing
        service and come back here.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void start()} disabled={busy}>
        {busy ? 'Please wait…' : 'Sign with Aadhaar'}
      </Button>
    </Card>
  );
}

function Ask({ token, onSent }: { token: string; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setBusy(true);
    setError('');
    try {
      await acceptApi.sendCode(token);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="grid gap-3 p-6">
      <p className="text-sm text-muted">
        When you have read the document, we will email you a six-digit code to confirm it is you.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void send()} disabled={busy}>
        {busy ? 'Sending…' : 'Send me a code'}
      </Button>
    </Card>
  );
}

function Confirm({ token, onDone }: { token: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(60);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await acceptApi.confirm(token, code);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setError('');
    setNote('');
    try {
      await acceptApi.sendCode(token);
      setWait(60);
      setNote('A new code was sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  return (
    <Card className="grid gap-4 p-6">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Six-digit code" htmlFor="code" hint="Check your email. The code works once.">
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="font-mono tracking-[0.4em]"
            required
          />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input
            id="consent"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 size-4"
          />
          <span>
            I have read this document and I accept it. I understand my name, email address, device
            and the time are recorded as proof.
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {note ? (
          <p role="status" className="text-sm text-success">
            {note}
          </p>
        ) : null}
        <Button type="submit" loading={busy} disabled={busy || code.length !== 6 || !consent}>
          {busy ? 'Confirming…' : 'Accept document'}
        </Button>
      </form>
      <Button variant="ghost" size="sm" disabled={wait > 0} onClick={() => void resend()}>
        {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
      </Button>
    </Card>
  );
}

function Decline({ token, onDone }: { token: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function go() {
    try {
      await acceptApi.decline(token, reason);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }
  if (!open)
    return (
      <button
        type="button"
        className="justify-self-center text-sm text-muted underline"
        onClick={() => setOpen(true)}
      >
        I do not want to accept this
      </button>
    );
  return (
    <Card className="grid gap-3 p-6">
      <Field label="Reason (optional)" htmlFor="reason">
        <Input
          id="reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => void go()}>
          Decline document
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
