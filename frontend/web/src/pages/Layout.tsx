import { AppShell, Button, type NavItem } from '@flourishive/ui';
import { FileText, LayoutTemplate, PenLine, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { go } from '../router.ts';

const NAV: NavItem[] = [
  { id: 'letters', label: 'Letters', icon: FileText },
  { id: 'signing', label: 'Signing queue', icon: PenLine },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'people', label: 'People', icon: Users },
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
  return (
    <AppShell
      brand={<span className="font-display text-2xl text-accent-hi">F</span>}
      nav={NAV}
      active={active}
      onNavigate={(id) => go(`/app/${id}`)}
      user={{ name: 'Noah Brooks', role: 'HR Lead' }}
      title={title}
      actions={
        actions ?? (
          <Button size="sm" onClick={() => go('/app/templates')}>
            New letter
          </Button>
        )
      }
    >
      {children}
    </AppShell>
  );
}
