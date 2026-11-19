import { LogOut, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Fragment, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { cn } from '../cn.ts';
import { Avatar } from './avatar.tsx';
import { CommandPalette, type Command } from './command-palette.tsx';
import { ThemeToggle } from './theme.tsx';

export type NavItem = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Heading shown above a run of items with the same group. */
  group?: string;
  /** A small tag on the item, e.g. "Preview". */
  tag?: string;
};

const KEY = 'fh-sidebar';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/**
 * Sidebar + top bar frame shared by web and admin: grouped menu, collapsible to icons
 * (remembered per device), breadcrumbs, Cmd/Ctrl+K search and an account menu.
 */
export function AppShell({
  brand,
  nav,
  active,
  onNavigate,
  user,
  onSignOut,
  title,
  crumbs,
  actions,
  commands = [],
  children,
}: {
  brand: ReactNode;
  nav: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  user: { name: string; role: string };
  onSignOut?: () => void;
  title: string;
  /** Shown above the title, e.g. ['People', 'Import']. */
  crumbs?: string[];
  actions?: ReactNode;
  /** Extra actions for the search palette (pages come from `nav`). */
  commands?: Command[];
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [searching, setSearching] = useState(false);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? 'open' : 'collapsed');
      } catch {
        /* storage unavailable: the choice just is not remembered */
      }
      return !c;
    });

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching((s) => !s);
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  const palette = useMemo<Command[]>(
    () => [
      ...nav.map((n) => ({
        id: `nav:${n.id}`,
        label: n.label,
        hint: n.group ?? 'Go to',
        icon: n.icon,
        run: () => onNavigate(n.id),
      })),
      ...commands,
    ],
    [nav, commands, onNavigate],
  );

  return (
    <div
      className={cn(
        'grid min-h-screen bg-bg transition-[grid-template-columns] duration-[var(--dur-fast)]',
        collapsed ? 'grid-cols-[72px_1fr]' : 'grid-cols-[72px_1fr] md:grid-cols-[248px_1fr]',
      )}
    >
      <aside className="sticky top-0 flex h-screen flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-3 md:p-4">
        <div
          className={cn(
            'mb-3 flex h-12 items-center justify-center gap-2',
            !collapsed && 'md:justify-start md:px-2',
          )}
        >
          {brand}
        </div>
        <nav aria-label="Main" className="grid gap-1">
          {nav.map(({ id, label, icon: Icon, group, tag }, i) => (
            <Fragment key={id}>
              {group && group !== nav[i - 1]?.group && (
                <div
                  className={cn(
                    'px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint',
                    collapsed ? 'hidden' : 'hidden md:block',
                  )}
                >
                  {group}
                </div>
              )}
              <button
                type="button"
                title={label}
                aria-label={label}
                aria-current={active === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}
                className={cn(
                  'flex h-11 items-center justify-center gap-3 rounded-pill px-3 text-sm font-medium transition-colors duration-[var(--dur-fast)]',
                  !collapsed && 'md:justify-start md:px-4',
                  active === id
                    ? 'bg-accent-lo text-accent-hi'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Icon size={19} />
                <span className={cn('hidden', !collapsed && 'md:inline')}>{label}</span>
                {tag && (
                  <span
                    className={cn(
                      'ml-auto hidden rounded-pill bg-surface-2 px-2 text-[11px] text-faint',
                      !collapsed && 'md:inline',
                    )}
                  >
                    {tag}
                  </span>
                )}
              </button>
            </Fragment>
          ))}
        </nav>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          className="mt-auto hidden h-11 items-center justify-center gap-3 rounded-pill px-3 text-sm text-faint hover:bg-surface-2 hover:text-fg md:flex md:px-4"
        >
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center gap-3 border-b border-line px-5 py-2 md:px-8">
          <div className="min-w-0">
            {crumbs && crumbs.length > 0 && (
              <div className="truncate text-xs text-muted">{crumbs.join('  /  ')}</div>
            )}
            <h1 className="truncate font-display text-3xl leading-none">{title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setSearching(true)}
              aria-label="Search"
              className="flex h-10 items-center gap-3 rounded-pill border border-line-strong px-3 text-sm text-muted hover:border-accent hover:text-fg md:w-56"
            >
              <Search size={17} />
              <span className="hidden md:inline">Search</span>
              <kbd className="ml-auto hidden rounded border border-line-strong px-1.5 font-mono text-[11px] md:inline">
                Ctrl K
              </kbd>
            </button>
            <ThemeToggle />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="flex items-center gap-3 rounded-pill p-1 pr-2 hover:bg-surface-2"
                >
                  <Avatar name={user.name} />
                  <div className="hidden text-left leading-tight md:block">
                    <div className="max-w-40 truncate text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted">{user.role}</div>
                  </div>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-50 min-w-56 rounded-card border border-line-strong bg-surface p-2 shadow-card"
                >
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted">{user.role}</div>
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item
                    onSelect={() => onSignOut?.()}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg"
                  >
                    <LogOut size={17} /> Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <main className="p-5 md:p-8">{children}</main>
      </div>
      <CommandPalette commands={palette} open={searching} onOpenChange={setSearching} />
    </div>
  );
}
