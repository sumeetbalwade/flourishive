import { AppShell, BrandMark, brand, type NavItem } from '@flourishive/ui';
import { Building2, Settings, ShieldCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';

const NAV: NavItem[] = [
  { id: 'tenants', label: 'Tenants', icon: Building2, group: 'Overview' },
  { id: 'settings', label: 'Platform defaults', icon: Settings, group: 'Platform' },
  { id: 'policy', label: 'Security policy', icon: ShieldCheck, group: 'Platform' },
  { id: 'users', label: 'Platform staff', icon: Users, group: 'Platform' },
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
      nav={NAV}
      active={active}
      onNavigate={(id) => go(`/${id}`)}
      user={{ name: auth.state.status === 'authed' ? auth.state.email : '…', role: 'Super admin' }}
      onSignOut={() => void auth.signOut()}
      crumbs={['Console', NAV.find((n) => n.id === active)?.group ?? '']}
      title={title}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}
