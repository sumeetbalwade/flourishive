import { AppShell, type NavItem } from '@flourishive/ui';
import {
  Building2,
  ClipboardList,
  FileText,
  LayoutTemplate,
  PenLine,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';

type Item = NavItem & { needs?: string };

/** Real screens first; the signing pages are design previews with sample data until Phase 2. */
const NAV: Item[] = [
  { id: 'people', label: 'People', icon: Users, needs: 'people.read' },
  { id: 'import', label: 'Import', icon: Upload, needs: 'people.import' },
  { id: 'org', label: 'Organisation', icon: Building2, needs: 'org.read' },
  { id: 'audit', label: 'Audit log', icon: ClipboardList, needs: 'audit.read' },
  { id: 'security', label: 'My security', icon: ShieldCheck },
  { id: 'letters', label: 'Letters (preview)', icon: FileText },
  { id: 'signing', label: 'Signing (preview)', icon: PenLine },
  { id: 'templates', label: 'Templates (preview)', icon: LayoutTemplate },
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
  const me = auth.state.status === 'authed' ? auth.state.me : null;
  const nav = NAV.filter((n) => !n.needs || auth.can(n.needs));
  return (
    <AppShell
      brand={<span className="font-display text-2xl text-accent-hi">F</span>}
      nav={nav}
      active={active}
      onNavigate={(id) => go(`/app/${id}`)}
      user={{ name: me?.email ?? '…', role: me?.mfaEnabled ? 'Two-step on' : 'Signed in' }}
      onSignOut={() => void auth.signOut()}
      title={title}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}
