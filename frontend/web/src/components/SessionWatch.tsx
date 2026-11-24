import { Button, Dialog, DialogContent, setRegion } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';

const WARN_MS = 60_000;
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;

/**
 * Once signed in: applies the company's region (date, number and money style) to every screen, and signs
 * the person out after the company's idle time with a one-minute warning (D-69).
 */
export function SessionWatch({ children }: { children: ReactNode }) {
  const api = useApi();
  const auth = useAuth();
  const authed = auth.state.status === 'authed';
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
    enabled: authed,
  });
  const values = settings.data?.values;
  const regionKey = JSON.stringify(
    Object.entries(values ?? {}).filter(([k]) => k.startsWith('region.')),
  );
  useEffect(() => {
    setRegion(JSON.parse(regionKey) ? Object.fromEntries(JSON.parse(regionKey)) : {});
  }, [regionKey]);

  const minutes = Number(values?.['security.idleTimeoutMinutes'] ?? 0);
  const [warning, setWarning] = useState<number | null>(null);
  const last = useRef(Date.now());

  useEffect(() => {
    if (!authed || !minutes) return;
    last.current = Date.now();
    const touch = () => {
      // A warning stays up until the person answers it; plain activity does not dismiss it.
      if (warning === null) last.current = Date.now();
    };
    for (const e of EVENTS) addEventListener(e, touch, { passive: true });
    const timer = setInterval(() => {
      const idle = Date.now() - last.current;
      const limit = minutes * 60_000;
      if (idle >= limit) {
        setWarning(null);
        void auth.signOut();
      } else if (idle >= limit - WARN_MS) setWarning(Math.ceil((limit - idle) / 1000));
    }, 1000);
    return () => {
      for (const e of EVENTS) removeEventListener(e, touch);
      clearInterval(timer);
    };
  }, [authed, minutes, warning, auth]);

  return (
    <Fragment key={regionKey}>
      {children}
      <Dialog open={warning !== null} onOpenChange={() => undefined}>
        <DialogContent
          title="Still there?"
          description={`For your security you will be signed out in ${warning ?? 0} seconds because there has been no activity.`}
        >
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => void auth.signOut()}>
              Sign out now
            </Button>
            <Button
              onClick={() => {
                last.current = Date.now();
                setWarning(null);
              }}
            >
              Stay signed in
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Fragment>
  );
}
