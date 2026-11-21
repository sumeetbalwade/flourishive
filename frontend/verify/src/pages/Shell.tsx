import { ThemeToggle, brand } from '@flourishive/ui';
import type { ReactNode } from 'react';
import { navigate } from '../router.ts';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-screen max-w-xl content-start gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="font-display text-3xl text-accent-hi"
        >
          {brand.appName}
        </a>
        <ThemeToggle />
      </header>
      <main>{children}</main>
      <footer className="text-center text-xs text-faint">
        Checks are made on the issuing company's records. No personal details are shown here.
      </footer>
    </div>
  );
}
