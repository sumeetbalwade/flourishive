import { Badge, Button, SigningAnimation, type SigningState } from '@flourishive/ui';
import { useState } from 'react';

/** Mock of the Flourishive Desktop window (Windows/macOS), used to approve its look. */
export default function Desktop() {
  const [state, setState] = useState<SigningState>('waiting');
  const [page, setPage] = useState(2);
  const label = {
    idle: 'Ready',
    signing: `Signing letter ${page} of 6`,
    waiting: 'Enter your token PIN',
    done: 'All 6 letters signed',
    failed: 'Token not found',
  }[state];
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-[420px] overflow-hidden rounded-card border border-line-strong bg-surface shadow-card">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-muted">
          <span className="h-3 w-3 rounded-pill bg-danger/70" />
          <span className="h-3 w-3 rounded-pill bg-warning/70" />
          <span className="h-3 w-3 rounded-pill bg-success/70" />
          <span className="ml-3">Flourishive Desktop</span>
          <Badge tone="success" className="ml-auto">
            Connected
          </Badge>
        </div>
        <div className="grid justify-items-center gap-4 px-8 py-10 text-center">
          <SigningAnimation state={state} progress={page / 6} size={120} />
          <h1 className="font-display text-3xl">{label}</h1>
          <p className="text-sm text-muted">
            mToken CryptoID · Noah Brooks · valid till 29 May 2028
          </p>
          {state === 'waiting' ? (
            <input
              aria-label="Token PIN"
              type="password"
              placeholder="Token PIN"
              className="h-11 w-56 rounded-pill border border-line-strong bg-surface-2 px-5 text-center text-sm focus-visible:border-accent"
            />
          ) : null}
          {state === 'signing' ? (
            <div className="h-1.5 w-56 overflow-hidden rounded-pill bg-surface-2">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${(page / 6) * 100}%` }}
              />
            </div>
          ) : null}
        </div>
        <div className="flex justify-center gap-2 border-t border-line p-4">
          <Button size="sm" variant="ghost" onClick={() => setState('waiting')}>
            PIN
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPage((p) => (p % 6) + 1);
              setState('signing');
            }}
          >
            Next letter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState('done')}>
            Done
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState('failed')}>
            Fail
          </Button>
        </div>
      </div>
    </div>
  );
}
