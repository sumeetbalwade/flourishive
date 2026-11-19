import { AppShell, type Command, type NavItem } from '@flourishive/ui';
import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  LayoutTemplate,
  PenLine,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';

type Item = NavItem & { needs?: string };

/**
 * One menu for everyone, trimmed by what the person's permissions allow, so an employee sees a
 * short list and HR sees the full one. The signing pages are previews with sample data until Phase 2.
 */
const NAV: Item[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'people', label: 'People', icon: Users, group: 'People', needs: 'people.read' },
  { id: 'import', label: 'Import', icon: Upload, group: 'People', needs: 'people.import' },
  { id: 'org', label: 'Organisation', icon: Building2, group: 'People', needs: 'org.read' },
  {
    id: 'templates',
    label: 'Templates',
    icon: LayoutTemplate,
    group: 'Documents',
    tag: 'Preview',
    needs: 'people.read',
  },
  {
    id: 'letters',
    label: 'Letters',
    icon: FileText,
    group: 'Documents',
    tag: 'Preview',
    needs: 'people.read',
  },
  {
    id: 'signing',
    label: 'Signing',
    icon: PenLine,
    group: 'Documents',
    tag: 'Preview',
    needs: 'people.read',
  },
  { id: 'audit', label: 'Audit log', icon: ClipboardList, group: 'Insights', needs: 'audit.read' },
  { id: 'security', label: 'My security', icon: ShieldCheck, group: 'Account' },
];

const LABELS = Object.fromEntries(NAV.map((n) => [n.id, n]));

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
  const nav = useMemo(() => NAV.filter((n) => !n.needs || auth.can(n.needs)), [auth]);
  const commands = useMemo<Command[]>(
    () =>
      auth.can('people.write')
        ? [
            {
              id: 'act:add-person',
              label: 'Add a person',
              hint: 'Action',
              icon: UserPlus,
              run: () => go('/app/people?new=1'),
            },
          ]
        : [],
    [auth],
  );
  const group = LABELS[active]?.group;
  const section = group ?? undefined;
  return (
    <AppShell
      brand={<span className="font-display text-2xl text-accent-hi">F</span>}
      nav={nav}
      active={active}
      onNavigate={(id) => go(`/app/${id}`)}
      commands={commands}
      crumbs={
        section && title !== LABELS[active]?.label
          ? [section, LABELS[active]!.label]
          : section
            ? [section]
            : undefined
      }
      user={{ name: me?.email ?? '…', role: roleLine(me?.mfaEnabled) }}
      onSignOut={() => void auth.signOut()}
      title={title}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}

const roleLine = (twoStep?: boolean) => (twoStep ? 'Two-step on' : 'Signed in');
