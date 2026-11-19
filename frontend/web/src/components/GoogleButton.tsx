import { Button } from '@flourishive/ui';
import { useEffect, useRef, useState } from 'react';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
type Gis = {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      prompt: () => void;
    };
  };
};

function loadScript(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google did not load')));
    s.onerror = () => reject(new Error('Google did not load'));
    document.head.append(s);
  });
}

/** Hidden entirely until a Google client id is configured (VITE_GOOGLE_CLIENT_ID). */
export function GoogleButton({
  onCredential,
  onError,
}: {
  onCredential: (idToken: string) => void;
  onError: (m: string) => void;
}) {
  const [ready, setReady] = useState<Gis | null>(null);
  const cb = useRef(onCredential);
  useEffect(() => {
    cb.current = onCredential;
  });

  useEffect(() => {
    if (!CLIENT_ID) return;
    let live = true;
    loadScript()
      .then((g) => {
        g.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (r) => cb.current(r.credential),
        });
        if (live) setReady(g);
      })
      .catch(() => live && onError('Google sign-in is unavailable right now.'));
    return () => {
      live = false;
    };
  }, [onError]);

  if (!CLIENT_ID) return null;
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={!ready}
        onClick={() => ready?.accounts.id.prompt()}
      >
        Sign in with Google
      </Button>
    </>
  );
}
