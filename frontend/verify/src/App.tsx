import { Badge, Button, Card, SigningAnimation, ThemeToggle, brand } from '@flourishive/ui';
import { useState } from 'react';

// Public verification page prototype (Phase 0). The real page looks the letter up by code.
export default function App() {
  const [valid, setValid] = useState(true);
  return (
    <div className="mx-auto grid min-h-screen max-w-xl content-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <span className="font-display text-3xl text-accent-hi">{brand.appName}</span>
        <ThemeToggle />
      </div>
      <Card className="grid justify-items-center gap-4 p-10 text-center">
        <SigningAnimation state={valid ? 'done' : 'failed'} size={110} />
        <h1 className="font-display text-4xl">{valid ? 'Genuine document' : 'Could not verify'}</h1>
        <p className="text-sm text-muted">
          {valid
            ? 'This letter was issued by Flourisense Technologies LLP and has not been altered since signing.'
            : 'The document does not match any issued letter, or it was changed after signing.'}
        </p>
        {valid ? (
          <dl className="mt-2 grid w-full grid-cols-2 gap-y-3 rounded-md border border-line p-5 text-left text-sm">
            <dt className="text-muted">Reference</dt>
            <dd className="font-mono text-xs">FS/HR/2026/0412</dd>
            <dt className="text-muted">Issued to</dt>
            <dd>Riya Patil</dd>
            <dt className="text-muted">Signed by</dt>
            <dd>Noah Brooks, HR Lead</dd>
            <dt className="text-muted">Signed on</dt>
            <dd>19 Nov 2026, 09:15 IST</dd>
            <dt className="text-muted">Checks</dt>
            <dd className="flex flex-wrap gap-1">
              <Badge tone="success">Integrity</Badge>
              <Badge tone="success">Timestamp</Badge>
            </dd>
          </dl>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setValid((v) => !v)}>
          Show {valid ? 'invalid' : 'valid'} result
        </Button>
      </Card>
    </div>
  );
}
