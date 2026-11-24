import { PageLoader, ToastProvider } from '@flourishive/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@flourishive/api-client';
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { ApiProvider, makeClient } from './lib/api.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { requestStepUp, StepUpHost } from './lib/step-up.tsx';
import type { ApiClient } from '@flourishive/api-client';
const Desktop = lazy(() => import('./pages/Desktop.tsx'));
const Gallery = lazy(() => import('./pages/Gallery.tsx'));
import { SupportEntry } from './pages/SupportEntry.tsx';
import { Audit } from './pages/Audit.tsx';
import { ForgotPassword, ResetPassword } from './pages/auth/Password.tsx';
import { FindCompany } from './pages/auth/FindCompany.tsx';
import { Login } from './pages/auth/Login.tsx';
import { Home } from './pages/Home.tsx';
import { BulkIssue } from './pages/letters/BulkIssue.tsx';
import { LetterDetail } from './pages/letters/LetterDetail.tsx';
import { LetterSetup } from './pages/letters/LetterSetup.tsx';
import { Letters } from './pages/letters/Letters.tsx';
import { NewLetter } from './pages/letters/NewLetter.tsx';
import { TemplateEdit } from './pages/letters/TemplateEdit.tsx';
import { Templates } from './pages/letters/Templates.tsx';
import { Company } from './pages/admin/Company.tsx';
import { Policy } from './pages/admin/Policy.tsx';
import { Roles } from './pages/admin/Roles.tsx';
import { Domains } from './pages/admin/Domains.tsx';
import { EmailSender } from './pages/admin/EmailSender.tsx';
import { Brand } from './pages/admin/Brand.tsx';
import { EmailLog } from './pages/admin/EmailLog.tsx';
import { Alerts } from './pages/admin/Alerts.tsx';
import { Notifications } from './pages/admin/Notifications.tsx';
import { Logs } from './pages/admin/Logs.tsx';
import { EmailTemplates } from './pages/admin/EmailTemplates.tsx';
import { Org } from './pages/org/Org.tsx';
import { ImportPeople } from './pages/people/Import.tsx';
import { PersonDetail } from './pages/people/PersonDetail.tsx';
import { People } from './pages/people/People.tsx';
import { Security } from './pages/Security.tsx';
const Signing = lazy(() => import('./pages/Signing.tsx').then((m) => ({ default: m.Signing })));
import { SessionWatch } from './components/SessionWatch.tsx';
import { go, useRoute } from './router.ts';

/** Permission each real screen needs; the API enforces the same, this only avoids dead ends. */
const NEEDS: Record<string, string | undefined> = {
  '/app/people': 'people.read',
  '/app/import': 'people.import',
  '/app/org': 'org.read',
  '/app/audit': 'audit.read',
  '/app/roles': 'roles.read',
  '/app/policy': 'roles.read',
  '/app/company': 'settings.read',
  '/app/email': 'email.manage',
  '/app/brand': 'brand.manage',
  '/app/domains': 'domains.manage',
  '/app/email-log': 'email.manage',
  '/app/logs': 'logs.read',
  '/app/notifications': 'settings.read',
  '/app/alerts': 'logs.read',
  '/app/email-templates': 'email.manage',
  '/app/letters': 'documents.read',
  '/app/templates': 'documents.read',
  '/app/letter-setup': 'documents.read',
};

function Private({ children, need }: { children: ReactNode; need?: string }) {
  const auth = useAuth();
  const anon = auth.state.status === 'anon';
  useEffect(() => {
    if (anon) go('/login');
  }, [anon]);
  if (auth.state.status !== 'authed') return <PageLoader fullscreen />;
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
    if (auth.state.status === 'authed' && (path === '/login' || path === '/')) go('/app/home');
  }, [auth.state.status, path]);

  if (path === '/login' || path === '/')
    return auth.state.status === 'loading' ? <PageLoader fullscreen /> : <Login />;
  if (path === '/support') return <SupportEntry token={query.get('token') ?? ''} />;
  if (path === '/find-company') return <FindCompany />;
  if (path === '/forgot-password') return <ForgotPassword />;
  if (path === '/reset-password') return <ResetPassword token={query.get('token') ?? ''} />;
  if (path === '/design') return <Gallery />;
  if (path === '/desktop') return <Desktop />;

  let page: ReactNode;
  if (path === '/app/home') page = <Home />;
  else if (path === '/app/people') page = <People />;
  else if (path.startsWith('/app/people/')) page = <PersonDetail id={path.split('/').pop()!} />;
  else if (path === '/app/import') page = <ImportPeople />;
  else if (path === '/app/org') page = <Org />;
  else if (path === '/app/audit') page = <Audit />;
  else if (path === '/app/roles') page = <Roles />;
  else if (path === '/app/policy') page = <Policy />;
  else if (path === '/app/company') page = <Company />;
  else if (path === '/app/email') page = <EmailSender />;
  else if (path === '/app/brand') page = <Brand />;
  else if (path === '/app/domains') page = <Domains />;
  else if (path === '/app/email-log') page = <EmailLog />;
  else if (path === '/app/logs') page = <Logs />;
  else if (path === '/app/notifications') page = <Notifications />;
  else if (path === '/app/alerts') page = <Alerts />;
  else if (path === '/app/email-templates') page = <EmailTemplates />;
  else if (path === '/app/security') page = <Security />;
  else if (path === '/app/signing') page = <Signing />;
  else if (path === '/app/templates') page = <Templates />;
  else if (path.startsWith('/app/templates/') && path.endsWith('/edit'))
    page = <TemplateEdit id={path.split('/')[3]!} />;
  else if (path === '/app/letter-setup') page = <LetterSetup />;
  else if (path === '/app/letters/new') page = <NewLetter />;
  else if (path === '/app/letters/bulk') page = <BulkIssue />;
  else if (path.startsWith('/app/letters/')) page = <LetterDetail id={path.split('/').pop()!} />;
  else if (path === '/app/letters') page = <Letters />;
  else if (path.startsWith('/app/')) page = <Home />;
  else return <Login />;
  return <Private need={NEEDS[path]}>{page}</Private>;
}

/** `client` and `retryDelay` exist so tests can inject a fake API and avoid waiting on backoff. */
export default function App({
  client: injected,
  retryDelay,
}: { client?: ApiClient; retryDelay?: number } = {}) {
  const client = useMemo(
    () => injected ?? makeClient(() => go('/login'), requestStepUp),
    [injected],
  );
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
          <StepUpHost>
            <AuthProvider>
              <SessionWatch>
                <Suspense fallback={<PageLoader fullscreen />}>
                  <Routes />
                </Suspense>
              </SessionWatch>
            </AuthProvider>
          </StepUpHost>
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
