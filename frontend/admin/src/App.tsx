import {
  AppShell,
  Avatar,
  Badge,
  Button,
  Card,
  CardTitle,
  Stat,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ToastProvider,
  useToast,
  type NavItem,
} from '@flourishive/ui';
import { Building2, CreditCard, Settings, Users } from 'lucide-react';
import { go, useRoute } from './router.ts';

const NAV: NavItem[] = [
  { id: 'tenants', label: 'Tenants', icon: Building2 },
  { id: 'users', label: 'Platform users', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const TENANTS = [
  {
    id: 'flourisense',
    name: 'Flourisense Technologies LLP',
    plan: 'Internal',
    users: 14,
    modules: ['Signing', 'People'],
    status: 'Active',
    created: '8 Nov 2026',
  },
  {
    id: 'acme',
    name: 'Acme Logistics',
    plan: 'Growth',
    users: 62,
    modules: ['Signing', 'People', 'Leave'],
    status: 'Trial',
    created: '15 Nov 2026',
  },
  {
    id: 'nova',
    name: 'Nova Retail Pvt Ltd',
    plan: 'Starter',
    users: 9,
    modules: ['Signing'],
    status: 'Suspended',
    created: '2 Nov 2026',
  },
];
const tone = { Active: 'success', Trial: 'warning', Suspended: 'danger' } as const;

function List() {
  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Stat value="3" label="Tenants" />
        <Stat value="85" label="Users across tenants" />
        <Stat value="1" label="Trial ending this week" />
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Tenant</TH>
            <TH>Plan</TH>
            <TH>Users</TH>
            <TH>Status</TH>
            <TH>Created</TH>
          </TR>
        </THead>
        <TBody>
          {TENANTS.map((t) => (
            <TR key={t.id} className="cursor-pointer" onClick={() => go(`/tenants/${t.id}`)}>
              <TD>
                <div className="flex items-center gap-3">
                  <Avatar name={t.name} />
                  {t.name}
                </div>
              </TD>
              <TD className="text-muted">{t.plan}</TD>
              <TD>{t.users}</TD>
              <TD>
                <Badge tone={tone[t.status as keyof typeof tone]}>{t.status}</Badge>
              </TD>
              <TD className="text-muted">{t.created}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

const ALL_MODULES = ['Signing', 'People', 'Leave & attendance', 'Payroll', 'Talent'];

function Detail({ id }: { id: string }) {
  const t = TENANTS.find((x) => x.id === id) ?? TENANTS[0]!;
  const toast = useToast();
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-6">
        <Card>
          <CardTitle>Modules</CardTitle>
          <ul className="mt-4 grid gap-3">
            {ALL_MODULES.map((m) => (
              <li
                key={m}
                className="flex items-center justify-between rounded-md border border-line px-4 py-3 text-sm"
              >
                {m}
                <Badge tone={t.modules.includes(m) ? 'success' : 'neutral'}>
                  {t.modules.includes(m) ? 'Enabled' : 'Off'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="content-start">
        <CardTitle>{t.name}</CardTitle>
        <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-muted">Plan</dt>
          <dd>{t.plan}</dd>
          <dt className="text-muted">Users</dt>
          <dd>{t.users}</dd>
          <dt className="text-muted">Status</dt>
          <dd>
            <Badge tone={tone[t.status as keyof typeof tone]}>{t.status}</Badge>
          </dd>
        </dl>
        <div className="mt-6 flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              toast({
                tone: 'info',
                title: 'Opening as support',
                description: 'Session is read-only and audited.',
              })
            }
          >
            Impersonate
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => toast({ tone: 'danger', title: `${t.name} suspended` })}
          >
            Suspend
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Super admin console prototype (Phase 0).
export default function App() {
  const route = useRoute();
  const detail = route.startsWith('/tenants/') ? route.split('/').pop()! : null;
  return (
    <ToastProvider>
      <AppShell
        brand={<span className="font-display text-2xl text-accent-hi">F</span>}
        nav={NAV}
        active="tenants"
        onNavigate={() => go('/tenants')}
        user={{ name: 'Sumeet Balwade', role: 'Super admin' }}
        title={detail ? 'Tenant' : 'Tenants'}
        actions={<Button size="sm">New tenant</Button>}
      >
        {detail ? <Detail id={detail} /> : <List />}
      </AppShell>
    </ToastProvider>
  );
}
