import type { MeResponse } from '@flourishive/schemas';
import { Button } from '@flourishive/ui';
import { LifeBuoy } from 'lucide-react';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** Shown on every screen while platform staff are in this company in a support session (D-56). */
export function SupportBanner({
  support,
  staff,
}: {
  support: NonNullable<MeResponse['support']>;
  staff: string;
}) {
  const api = useApi();
  const auth = useAuth();
  return (
    <div className="flex flex-wrap items-center gap-3" role="status">
      <LifeBuoy size={16} className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        <strong>Support session:</strong> {staff} is{' '}
        {support.mode === 'READ' ? 'viewing (view only)' : 'viewing and able to change'} this
        company until {time(support.expiresAt)}. Reason: “{support.reason}”
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await api.support.endCurrent();
          } finally {
            await auth.signOut();
          }
        }}
      >
        End session
      </Button>
    </div>
  );
}
