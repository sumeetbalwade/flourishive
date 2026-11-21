import type { CompareResult, VerifyResult } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  Skeleton,
  SigningAnimation,
  type SigningState,
} from '@flourishive/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiProblem, verifyApi } from '../api.ts';

const TYPES: Record<string, string> = {
  OFFER: 'Offer letter',
  EXPERIENCE: 'Experience letter',
  REFERENCE: 'Reference letter',
  CERTIFICATE: 'Internship certificate',
};
const STAGE: Record<string, string> = {
  approved: 'Approved, waiting for signatures',
  signing: 'Being signed',
  issued: 'Issued',
};
const HEAD: Record<VerifyResult['result'], { title: string; line: string; state: SigningState }> = {
  valid: {
    title: 'Genuine document',
    line: 'This document was issued by the company below and its records match.',
    state: 'done',
  },
  pending: {
    title: 'Approved, not yet complete',
    line: 'The company approved this document, but its signing is not finished.',
    state: 'waiting',
  },
  revoked: {
    title: 'Withdrawn',
    line: 'The company has withdrawn this document. Do not rely on it.',
    state: 'failed',
  },
  superseded: {
    title: 'Replaced by a newer version',
    line: 'The company has issued a newer version of this document.',
    state: 'failed',
  },
};
const date = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso)) + ' IST';

export function Verify({ token }: { token: string }) {
  const [r, setR] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    verifyApi.byToken(token).then(
      (v) => live && setR(v),
      (e: unknown) =>
        live &&
        setError({
          notFound: e instanceof ApiProblem && e.status === 404,
          message: e instanceof Error ? e.message : 'Something went wrong.',
        }),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (error)
    return (
      <Card className="grid justify-items-center gap-4 p-10 text-center">
        <SigningAnimation state="failed" size={96} />
        <h1 className="font-display text-3xl">
          {error.notFound ? 'Could not verify' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-muted">
          {error.notFound
            ? 'No issued document matches this code. The document may be a copy that was not issued by the company, or the code may be mistyped.'
            : error.message}
        </p>
      </Card>
    );
  if (!r)
    return (
      <Card className="grid gap-4 p-10">
        <Skeleton className="mx-auto size-24 rounded-full" />
        <Skeleton className="h-8" />
        <Skeleton className="h-24" />
      </Card>
    );

  const head = HEAD[r.result];
  return (
    <div className="grid gap-5">
      <Card className="grid justify-items-center gap-4 p-8 text-center">
        <SigningAnimation state={head.state} size={104} />
        <h1 className="font-display text-3xl">{r.test ? 'Test document' : head.title}</h1>
        {r.test ? (
          <Badge tone="warning">Signed during testing. Not a genuine issued document.</Badge>
        ) : null}
        <p className="text-sm text-muted">{head.line}</p>
        <dl className="grid w-full grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-md border border-line p-5 text-left text-sm">
          <dt className="text-muted">Reference</dt>
          <dd className="font-mono text-xs">{r.reference}</dd>
          <dt className="text-muted">Document</dt>
          <dd>{TYPES[r.letterType] ?? r.letterType}</dd>
          <dt className="text-muted">Issued by</dt>
          <dd>{r.issuedBy}</dd>
          <dt className="text-muted">Created</dt>
          <dd>{date(r.issuedOn)}</dd>
          <dt className="text-muted">Status</dt>
          <dd>{STAGE[r.stage] ?? r.stage}</dd>
          <dt className="text-muted">Signed by</dt>
          <dd>
            {r.signature ? (
              <span>
                {r.signature.signer}
                {r.signature.organisation ? `, ${r.signature.organisation}` : ''}
                <span className="block text-xs text-muted">
                  {date(r.signature.at)} · certificate from {r.signature.issuer}
                </span>
              </span>
            ) : (
              <span className="text-muted">Not yet signed</span>
            )}
          </dd>
          <dt className="text-muted">Acceptance</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {r.acceptance ? (
              <>
                <span>{date(r.acceptance.at)}</span>
                {r.acceptance.sealed ? <Badge tone="success">Sealed</Badge> : null}
              </>
            ) : (
              <span className="text-muted">Not yet recorded</span>
            )}
          </dd>
        </dl>
      </Card>
      <Compare token={token} />
    </div>
  );
}

function Compare({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function check(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setRes(null);
    setError('');
    try {
      setRes(await verifyApi.compare(token, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h2 className="font-display text-xl">Check your copy</h2>
        <p className="text-sm text-muted">
          Choose the PDF you received. It is compared with the issued file here; it is not stored.
        </p>
      </div>
      <input
        ref={input}
        id="copy"
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(e) => void check(e.target.files?.[0])}
      />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Checking…' : 'Choose PDF'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {res ? <CompareOutcome r={res} /> : null}
    </Card>
  );
}

function CompareOutcome({ r }: { r: CompareResult }) {
  const same = r.matches !== 'different';
  const notes: string[] = [];
  if (!same && r.seal) {
    if (!r.seal.intact) notes.push('The file was changed after it was sealed.');
    else if (!r.seal.coversWholeFile)
      notes.push('Something was added to the file after it was sealed.');
    if (!r.seal.sealedByUs) notes.push('The seal was not made by this service.');
  }
  return (
    <div
      role="status"
      className={`grid gap-2 rounded-md border p-4 text-sm ${same ? 'border-success bg-success-lo' : 'border-danger bg-danger-lo'}`}
    >
      <p className="font-medium">
        {r.matches === 'signed-copy'
          ? 'Identical to the signed document. Nothing has been changed.'
          : r.matches === 'accepted-copy'
            ? 'Identical to the accepted copy. Nothing has been changed.'
            : r.matches === 'original'
              ? 'Identical to the issued document, before acceptance.'
              : 'This file does not match the issued document.'}
      </p>
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
      {same && r.seal?.timestamp ? <p>Time-stamped {date(r.seal.timestamp.time)}.</p> : null}
      <p className="break-all font-mono text-xs text-muted">SHA-256 {r.fingerprint}</p>
    </div>
  );
}
