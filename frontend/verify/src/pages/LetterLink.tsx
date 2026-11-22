import { Badge, Button, Card, Skeleton } from '@flourishive/ui';
import { useEffect, useState } from 'react';
import { ApiProblem, letterApi, type LetterInfo } from '../api.ts';

const TYPES: Record<string, string> = {
  OFFER: 'Offer letter',
  EXPERIENCE: 'Experience letter',
  REFERENCE: 'Reference letter',
  CERTIFICATE: 'Internship certificate',
};

/** The page behind the emailed link. Offer letters may be held: the person can see them but not take the file yet. */
export function LetterLink({ token }: { token: string }) {
  const [info, setInfo] = useState<LetterInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    letterApi.info(token).then(
      (v) => live && setInfo(v),
      (e: unknown) =>
        live &&
        setError(
          e instanceof ApiProblem && e.status === 404
            ? 'This link is no longer valid. Ask the company to send you a new one.'
            : e instanceof Error
              ? e.message
              : 'Something went wrong.',
        ),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (error)
    return (
      <Card className="grid gap-3 p-10 text-center">
        <h1 className="font-display text-3xl">Link not available</h1>
        <p className="text-sm text-muted">{error}</p>
      </Card>
    );
  if (!info)
    return (
      <Card className="grid gap-4 p-10">
        <Skeleton className="h-8" />
        <Skeleton className="h-24" />
      </Card>
    );
  return (
    <Card className="grid gap-5 p-8">
      <h1 className="font-display text-3xl">{TYPES[info.letterType] ?? 'Your letter'}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-md border border-line p-5 text-sm">
        <dt className="text-muted">Reference</dt>
        <dd className="font-mono text-xs">{info.reference}</dd>
        <dt className="text-muted">From</dt>
        <dd>{info.issuer}</dd>
      </dl>
      {info.downloadAllowed ? (
        <a href={letterApi.downloadUrl(token)}>
          <Button className="w-full">Download the letter (PDF)</Button>
        </a>
      ) : (
        <div className="grid gap-2">
          <Badge tone="warning">Download not open yet</Badge>
          <p className="text-sm text-muted">{info.message}</p>
        </div>
      )}
    </Card>
  );
}
