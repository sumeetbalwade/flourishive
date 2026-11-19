import { LogOut } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../cn.ts';
import { Avatar } from './avatar.tsx';
import { ThemeToggle } from './theme.tsx';

export type NavItem = { id: string; label: string; icon: ComponentType<{ size?: number }> };

/** Sidebar + top bar frame shared by web and admin. Tenant branding comes in via props. */
export function AppShell({
  brand,
  nav,
  active,
  onNavigate,
  user,
  title,
  actions,
  children,
}: {
  brand: ReactNode;
  nav: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  user: { name: string; role: string };
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-[72px_1fr] bg-bg md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 flex h-screen flex-col gap-2 border-r border-line bg-surface p-3 md:p-4">
        <div className="mb-4 flex h-12 items-center justify-center gap-2 md:justify-start md:px-2">
          {brand}
        </div>
        <nav aria-label="Main" className="grid gap-1">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
              className={cn(
                'flex h-11 items-center justify-center gap-3 rounded-pill px-3 text-sm font-medium transition-colors duration-[var(--dur-fast)] md:justify-start md:px-4',
                active === id
                  ? 'bg-accent-lo text-accent-hi'
                  : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon size={19} />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="mt-auto flex h-11 items-center justify-center gap-3 rounded-pill px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg md:justify-start md:px-4"
        >
          <LogOut size={19} />
          <span className="hidden md:inline">Sign out</span>
        </button>
      </aside>
      <div className="min-w-0">
        <header className="flex h-16 items-center gap-3 border-b border-line px-5 md:px-8">
          <h1 className="font-display text-3xl leading-none">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <ThemeToggle />
            <div className="flex items-center gap-3 pl-2">
              <Avatar name={user.name} />
              <div className="hidden text-left leading-tight md:block">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-xs text-muted">{user.role}</div>
              </div>
            </div>
          </div>
        </header>
        <main className="p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
