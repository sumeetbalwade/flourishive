import { AppShell, BrandMark, brand, type Command, type NavItem } from '@flourishive/ui';
import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  KeyRound,
  Settings,
  LayoutTemplate,
  Stamp,
  PenLine,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { SupportBanner } from '../components/SupportBanner.tsx';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';

type Item = NavItem & { needs?: string };

/**
 * One menu for everyone, trimmed by what the person's permissions allow, so an employee sees a
 * short list and HR sees the full one. Letters and templates are live; the signing queue is still a preview.
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
    needs: 'documents.read',
  },
  {
    id: 'letters',
    label: 'Letters',
    icon: FileText,
    group: 'Documents',
    needs: 'documents.read',
  },
  {
    id: 'letter-setup',
    label: 'Letter setup',
    icon: Stamp,
    group: 'Documents',
    needs: 'documents.manage',
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
  {
    id: 'roles',
    label: 'Roles & access',
    icon: KeyRound,
    group: 'Administration',
    needs: 'roles.read',
  },
  {
    id: 'policy',
    label: 'Security policy',
    icon: ShieldCheck,
    group: 'Administration',
    needs: 'roles.read',
  },
  {
    id: 'company',
    label: 'Company settings',
    icon: Settings,
    group: 'Administration',
    needs: 'settings.read',
  },
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
      banner={me?.support ? <SupportBanner support={me.support} staff={me.email} /> : undefined}
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
