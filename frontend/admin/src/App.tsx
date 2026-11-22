import { ApiError, type PlatformClient } from '@flourishive/api-client';
import { PageLoader, ToastProvider } from '@flourishive/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { ApiProvider, makeClient } from './lib/api.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { Defaults } from './pages/Defaults.tsx';
import { Policy } from './pages/Policy.tsx';
import { Login, SetPassword } from './pages/Login.tsx';
import { Staff } from './pages/Staff.tsx';
import { TenantDetail } from './pages/TenantDetail.tsx';
import { System } from './pages/System.tsx';
import { Tenants } from './pages/Tenants.tsx';
import { go, useRoute } from './router.ts';

const Loading = () => <PageLoader fullscreen />;

function Private({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const anon = auth.state.status === 'anon';
  useEffect(() => {
    if (anon) go('/login');
  }, [anon]);
  return auth.state.status === 'authed' ? <>{children}</> : <Loading />;
}

function Routes() {
  const { path, query } = useRoute();
  const auth = useAuth();
  useEffect(() => {
    if (auth.state.status === 'authed' && (path === '/login' || path === '/')) go('/tenants');
  }, [auth.state.status, path]);

  if (path === '/login' || path === '/')
    return auth.state.status === 'loading' ? <Loading /> : <Login />;
  if (path === '/set-password') return <SetPassword token={query.get('token') ?? ''} />;
  let page: ReactNode;
  if (path === '/tenants') page = <Tenants />;
  else if (path.startsWith('/tenants/')) page = <TenantDetail id={path.split('/').pop()!} />;
  else if (path === '/users') page = <Staff />;
  else if (path === '/settings') page = <Defaults />;
  else if (path === '/policy') page = <Policy />;
  else if (path === '/system') page = <System />;
  else return <Login />;
  return <Private>{page}</Private>;
}

/** `client` and `retryDelay` exist so tests can inject a fake API and avoid waiting on backoff. */
export default function App({
  client: injected,
  retryDelay,
}: { client?: PlatformClient; retryDelay?: number } = {}) {
  const client = useMemo(() => injected ?? makeClient(() => go('/login')), [injected]);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retryDelay,
            retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
          },
        },
      }),
    [retryDelay],
  );
  return (
    <ApiProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <Routes />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
