import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark, brand } from '@flourishive/ui';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';

/**
 * While the platform is in maintenance, company people see this page instead of the app (D-70). Platform staff
 * in a support session carry on. The state is checked on load and every minute.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const api = useApi();
  const auth = useAuth();
  const q = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => api.maintenance(),
    refetchInterval: 60_000,
    retry: false,
  });
  const inSupport = auth.state.status === 'authed' && Boolean(auth.state.me.support);
  if (!q.data?.enabled || inSupport) return <>{children}</>;
  const until = q.data.until
    ? new Date(q.data.until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 w-fit">
          <BrandMark />
        </div>
        <Wrench className="mx-auto mb-3 text-muted" aria-hidden />
        <h1 className="font-display text-2xl">We’ll be right back</h1>
        <p className="mt-3 text-sm text-muted">
          {q.data.message || `${brand.appName} is down for a little maintenance.`}
        </p>
        {until ? <p className="mt-2 text-sm text-muted">Expected back around {until}.</p> : null}
        <p className="mt-6 text-xs text-muted">
          Your work is safe. This page checks again by itself.
        </p>
      </div>
    </main>
  );
}
