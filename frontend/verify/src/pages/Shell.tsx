import { BrandMark, ThemeToggle, brand } from '@flourishive/ui';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { navigate } from '../router.ts';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[44rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
      />
      <div className="relative mx-auto grid min-h-screen max-w-xl content-start gap-6 px-4 py-8">
        <header className="flex items-center justify-between rounded-pill border border-line bg-glass py-2 pl-2 pr-3 shadow-card backdrop-blur-md">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="flex items-center gap-3 rounded-pill pr-3 font-display text-xl font-medium"
          >
            <BrandMark size={36} />
            {brand.appName}
          </a>
          <ThemeToggle />
        </header>
        <main className="animate-rise">{children}</main>
        <footer className="flex items-center justify-center gap-2 text-center text-xs text-faint">
          <ShieldCheck size={14} className="shrink-0 text-accent" />
          Checks are made on the issuing company's records. No personal details are shown here.
        </footer>
      </div>
    </div>
  );
}
