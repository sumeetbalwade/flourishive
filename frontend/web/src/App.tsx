import { ToastProvider } from '@flourishive/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@flourishive/api-client';
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { ApiProvider, makeClient } from './lib/api.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import type { ApiClient } from '@flourishive/api-client';
const Desktop = lazy(() => import('./pages/Desktop.tsx'));
const Document = lazy(() => import('./pages/Document.tsx').then((m) => ({ default: m.Document })));
const Gallery = lazy(() => import('./pages/Gallery.tsx'));
const Letters = lazy(() => import('./pages/Letters.tsx').then((m) => ({ default: m.Letters })));
import { Audit } from './pages/Audit.tsx';
import { ForgotPassword, ResetPassword } from './pages/auth/Password.tsx';
import { FindCompany } from './pages/auth/FindCompany.tsx';
import { Login } from './pages/auth/Login.tsx';
import { Org } from './pages/org/Org.tsx';
import { ImportPeople } from './pages/people/Import.tsx';
import { PersonDetail } from './pages/people/PersonDetail.tsx';
import { People } from './pages/people/People.tsx';
import { Security } from './pages/Security.tsx';
const Signing = lazy(() => import('./pages/Signing.tsx').then((m) => ({ default: m.Signing })));
const Templates = lazy(() =>
  import('./pages/Templates.tsx').then((m) => ({ default: m.Templates })),
);
import { go, useRoute } from './router.ts';

/** Permission each real screen needs; the API enforces the same, this only avoids dead ends. */
const NEEDS: Record<string, string | undefined> = {
  '/app/people': 'people.read',
  '/app/import': 'people.import',
  '/app/org': 'org.read',
  '/app/audit': 'audit.read',
};

function Private({ children, need }: { children: ReactNode; need?: string }) {
  const auth = useAuth();
  const anon = auth.state.status === 'anon';
  useEffect(() => {
    if (anon) go('/login');
  }, [anon]);
  if (auth.state.status !== 'authed') return <p className="p-10 text-sm text-muted">Loading…</p>;
  if (need && !auth.can(need))
    return (
      <p className="p-10 text-sm text-muted">
        You do not have access to this page.{' '}
        <a className="underline" href="#/app/security">
          Go to My security
        </a>
      </p>
    );
  return <>{children}</>;
}

function Routes() {
  const { path, query } = useRoute();
  const auth = useAuth();

  // Already signed in? Skip the sign-in screens.
  useEffect(() => {
    if (auth.state.status === 'authed' && (path === '/login' || path === '/')) go('/app/people');
  }, [auth.state.status, path]);

  if (path === '/login' || path === '/')
    return auth.state.status === 'loading' ? (
      <p className="p-10 text-sm text-muted">Loading…</p>
    ) : (
      <Login />
    );
  if (path === '/find-company') return <FindCompany />;
  if (path === '/forgot-password') return <ForgotPassword />;
  if (path === '/reset-password') return <ResetPassword token={query.get('token') ?? ''} />;
  if (path === '/design') return <Gallery />;
  if (path === '/desktop') return <Desktop />;

  let page: ReactNode;
  if (path === '/app/people') page = <People />;
  else if (path.startsWith('/app/people/')) page = <PersonDetail id={path.split('/').pop()!} />;
  else if (path === '/app/import') page = <ImportPeople />;
  else if (path === '/app/org') page = <Org />;
  else if (path === '/app/audit') page = <Audit />;
  else if (path === '/app/security') page = <Security />;
  else if (path === '/app/signing') page = <Signing />;
  else if (path === '/app/templates') page = <Templates />;
  else if (path.startsWith('/app/letters/')) page = <Document id={path.split('/').pop()!} />;
  else if (path.startsWith('/app/')) page = <Letters />;
  else return <Login />;
  return <Private need={NEEDS[path]}>{page}</Private>;
}

/** `client` and `retryDelay` exist so tests can inject a fake API and avoid waiting on backoff. */
export default function App({
  client: injected,
  retryDelay,
}: { client?: ApiClient; retryDelay?: number } = {}) {
  const client = useMemo(() => injected ?? makeClient(() => go('/login')), [injected]);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retryDelay,
            // A refused request (403/404/validation) will not succeed on retry.
            retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
          },
        },
      }),
    [],
  );
  return (
    <ApiProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <Suspense fallback={<p className="p-10 text-sm text-muted">Loading…</p>}>
              <Routes />
            </Suspense>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
