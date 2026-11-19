import { AppShell, type NavItem } from '@flourishive/ui';
import { Building2, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';

const NAV: NavItem[] = [
  { id: 'tenants', label: 'Tenants', icon: Building2 },
  { id: 'users', label: 'Platform users', icon: Users },
  { id: 'settings', label: 'Defaults', icon: Settings },
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
      brand={<span className="font-display text-2xl text-accent-hi">F</span>}
      nav={NAV}
      active={active}
      onNavigate={(id) => go(`/${id}`)}
      user={{ name: auth.state.status === 'authed' ? auth.state.email : '…', role: 'Super admin' }}
      onSignOut={() => void auth.signOut()}
      title={title}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}
