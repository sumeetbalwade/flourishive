import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { Card, CardTitle } from './card.tsx';
import { fmtDateTime } from '../format.ts';

export interface PasskeyItem {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
}

const day = (iso: string) => fmtDateTime(iso);

/**
 * Passkeys on My security (D-64): add one (Touch ID, Face ID, Windows Hello or a security key) and
 * remove old ones. The browser ceremony itself runs in the app that passes `onAdd`.
 */
export function PasskeysCard({
  passkeys,
  supported,
  onAdd,
  onRemove,
}: {
  passkeys: PasskeyItem[];
  /** False when this browser cannot make passkeys. */
  supported: boolean;
  /** Runs the whole add flow (confirm it is you, then the browser prompt). Throws a readable error. */
  onAdd: () => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Passkeys</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Sign in with your fingerprint, face or screen lock instead of typing a password and a
            code. A passkey works only on this site and cannot be phished.
          </p>
        </div>
        <Badge tone={passkeys.length ? 'success' : 'neutral'}>{passkeys.length}</Badge>
      </div>
      {passkeys.length ? (
        <ul className="mt-4 grid gap-2">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line px-4 py-3 text-sm"
            >
              <KeyRound size={16} className="text-muted" aria-hidden />
              <span className="font-medium">{p.label}</span>
              <span className="text-xs text-faint">
                added {day(p.createdAt)} · last used {day(p.lastUsedAt)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void onRemove(p.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {supported ? (
        <Button
          className="mt-4"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onAdd();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not add the passkey');
            } finally {
              setBusy(false);
            }
          }}
        >
          Add a passkey
        </Button>
      ) : (
        <p className="mt-4 text-sm text-muted">This browser cannot make passkeys.</p>
      )}
    </Card>
  );
}
