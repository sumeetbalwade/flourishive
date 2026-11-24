import { AppShell, BrandMark, brand, type NavItem } from '@flourishive/ui';
import {
  Activity,
  Building2,
  KeyRound,
  MailCheck,
  MailPlus,
  Palette,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth, useCan } from '../lib/auth.tsx';
import { INTEGRATION_SECTIONS } from '../lib/integration-sections.ts';
import { go } from '../router.ts';

type Item = NavItem & { needs?: string[] };
const NAV: Item[] = [
  { id: 'tenants', label: 'Tenants', icon: Building2, group: 'Overview', needs: ['tenants.read'] },
  {
    id: 'settings',
    label: 'Platform defaults',
    icon: Settings,
    group: 'Platform',
    needs: ['config.read'],
  },
  {
    id: 'policy',
    label: 'Security policy',
    icon: ShieldCheck,
    group: 'Platform',
    needs: ['config.read'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: KeyRound,
    group: 'Platform',
    children: INTEGRATION_SECTIONS,
    needs: ['config.read'],
  },
  {
    id: 'email-log',
    label: 'Email log',
    icon: MailCheck,
    group: 'Platform',
    needs: ['email.manage'],
  },
  {
    id: 'product-brand',
    label: 'Product brand',
    icon: Palette,
    group: 'Platform',
    needs: ['brand.manage'],
  },
  {
    id: 'email-templates',
    label: 'Email wording',
    icon: MailPlus,
    group: 'Platform',
    needs: ['email.manage'],
  },
  { id: 'users', label: 'Platform staff', icon: Users, group: 'Platform', needs: ['staff.manage'] },
  {
    id: 'roles',
    label: 'Staff roles',
    icon: UserCog,
    group: 'Platform',
    needs: ['roles.manage', 'staff.manage'],
  },
  {
    id: 'system',
    label: 'System checks',
    icon: Activity,
    group: 'Platform',
    needs: ['config.read'],
  },
  { id: 'security', label: 'My security', icon: ShieldCheck, group: 'Account' },
];

export function Layout({
  active,
  title,
  actions,
  children,
}: {
  active: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const auth = useAuth();
  const can = useCan();
  const nav = NAV.filter((n) => !n.needs || can(...n.needs));
  return (
    <AppShell
      brand={
        <span className="flex items-center gap-3" title={brand.appName}>
          <BrandMark />
          <span className="hidden font-display text-xl font-medium md:inline group-data-[collapsed=true]/side:md:hidden">
            {brand.appName}
          </span>
        </span>
      }
      nav={nav}
      active={active}
      onNavigate={(id) => go(`/${id}`)}
      user={{
        name: auth.state.status === 'authed' ? auth.state.email : '…',
        role: auth.state.status === 'authed' ? (auth.state.role?.name ?? 'Staff') : '',
      }}
      onSignOut={() => void auth.signOut()}
      crumbs={['Console', NAV.find((n) => n.id === active.split('/')[0])?.group ?? '']}
      title={title}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}
