import { ChevronRight, LogOut, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { Fragment, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { cn } from '../cn.ts';
import { Avatar } from './avatar.tsx';
import { CommandPalette, type Command } from './command-palette.tsx';
import { item as menuItem, panel } from './popover-styles.ts';
import { ThemeToggle } from './theme.tsx';

export type NavItem = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Heading shown above a run of items with the same group. */
  group?: string;
  /** A small tag on the item, e.g. "Preview". */
  tag?: string;
  /**
   * Sub-options shown under the item while it is active. A child's id is passed to onNavigate
   * as `<parent id>/<child id>`, so a page can open and scroll to that section.
   */
  children?: { id: string; label: string }[];
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
      ...nav.flatMap((n) => [
        {
          id: `nav:${n.id}`,
          label: n.label,
          hint: n.group ?? 'Go to',
          icon: n.icon,
          run: () => onNavigate(n.id),
        },
        ...(n.children ?? []).map((c) => ({
          id: `nav:${n.id}/${c.id}`,
          label: `${n.label} › ${c.label}`,
          hint: n.group ?? 'Go to',
          icon: n.icon,
          run: () => onNavigate(`${n.id}/${c.id}`),
        })),
      ]),
      ...commands,
    ],
    [nav, commands, onNavigate],
  );

  return (
    <div
      className={cn(
        'grid min-h-screen bg-bg transition-[grid-template-columns] duration-[var(--dur-base)] ease-[var(--ease-out)]',
        collapsed ? 'grid-cols-[88px_1fr]' : 'grid-cols-[88px_1fr] md:grid-cols-[272px_1fr]',
      )}
    >
      <aside
        data-collapsed={collapsed}
        className="group/side sticky top-3 m-3 mr-0 flex h-[calc(100vh-24px)] flex-col gap-1 overflow-y-auto rounded-card border border-line bg-surface p-3 shadow-card md:p-4"
      >
        <div
          className={cn(
            'mb-3 flex h-12 items-center justify-center gap-2',
            !collapsed && 'md:justify-start md:px-2',
          )}
        >
          {brand}
        </div>
        <nav aria-label="Main" className="grid gap-1">
          {nav.map(({ id, label, icon: Icon, group, tag, children: subs }, i) => {
            const here = active === id || active.startsWith(`${id}/`);
            return (
              <Fragment key={id}>
                {group && group !== nav[i - 1]?.group && (
                  <div
                    className={cn(
                      'px-4 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint',
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
                  aria-expanded={subs ? here : undefined}
                  onClick={() => onNavigate(id)}
                  className={cn(
                    'group relative flex h-11 items-center justify-center gap-3 rounded-pill px-3 text-sm font-medium transition-colors duration-[var(--dur-fast)] active:scale-[0.98]',
                    !collapsed && 'md:justify-start md:px-4',
                    here ? 'text-on-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {here && (
                    <motion.span
                      layoutId="nav-active"
                      aria-hidden="true"
                      transition={{ type: 'spring', stiffness: 460, damping: 38 }}
                      className="absolute inset-0 rounded-pill bg-accent shadow-press"
                    />
                  )}
                  <Icon size={19} className="relative" />
                  <span className={cn('relative hidden', !collapsed && 'md:inline')}>{label}</span>
                  {tag && (
                    <span
                      className={cn(
                        'relative ml-auto hidden rounded-pill px-2 py-0.5 text-[11px]',
                        here ? 'bg-on-accent/20' : 'bg-surface-2 text-faint',
                        !collapsed && 'md:inline',
                      )}
                    >
                      {tag}
                    </span>
                  )}
                </button>
                {subs && here && !collapsed ? (
                  <ul className="hidden gap-0.5 pb-1 pl-5 md:grid" aria-label={`${label} sections`}>
                    {subs.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onNavigate(`${id}/${c.id}`)}
                          aria-current={active === `${id}/${c.id}` ? 'location' : undefined}
                          className={cn(
                            'flex h-9 w-full items-center gap-2 rounded-pill px-4 text-left text-[13px] transition-colors',
                            active === `${id}/${c.id}`
                              ? 'bg-accent-lo font-medium text-accent-hi'
                              : 'text-muted hover:bg-surface-2 hover:text-fg',
                          )}
                        >
                          <ChevronRight size={13} className="shrink-0" />
                          <span className="truncate">{c.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Fragment>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          className="mt-auto hidden h-11 items-center justify-center gap-3 rounded-pill px-3 text-sm text-faint transition-colors hover:bg-surface-2 hover:text-fg active:scale-[0.98] md:flex md:px-4"
        >
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex min-h-20 items-center gap-3 bg-bg/80 px-5 py-3 backdrop-blur-md md:px-8">
          <div className="min-w-0">
            {crumbs && crumbs.length > 0 && (
              <div className="truncate text-xs text-muted">{crumbs.join('  ›  ')}</div>
            )}
            <h1 className="truncate font-display text-[34px] font-medium leading-tight tracking-tight">
              {title}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setSearching(true)}
              aria-label="Search"
              className="flex h-11 items-center gap-3 rounded-pill border border-line bg-surface px-4 text-sm text-muted shadow-card transition-[border-color,color,transform] hover:border-accent hover:text-fg active:scale-[0.98] md:w-60"
            >
              <Search size={17} />
              <span className="hidden md:inline">Search</span>
              <kbd className="ml-auto hidden rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] md:inline">
                Ctrl K
              </kbd>
            </button>
            <ThemeToggle />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="flex items-center gap-3 rounded-pill bg-surface p-1 pr-3 shadow-card transition-[transform,box-shadow] hover:shadow-pop active:scale-[0.98] data-[state=open]:shadow-pop"
                >
                  <Avatar name={user.name} />
                  <div className="hidden text-left leading-tight md:block">
                    <div className="max-w-40 truncate text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted">{user.role}</div>
                  </div>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={10} className={cn(panel, 'min-w-60')}>
                  <div className="px-3 py-2.5">
                    <div className="truncate text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted">{user.role}</div>
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item
                    onSelect={() => onSignOut?.()}
                    className={cn(menuItem, 'text-muted')}
                  >
                    <LogOut size={17} /> Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <motion.main
          key={active.split('/')[0]}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="px-5 pb-10 pt-2 md:px-8"
        >
          {children}
        </motion.main>
      </div>
      <CommandPalette commands={palette} open={searching} onOpenChange={setSearching} />
    </div>
  );
}
