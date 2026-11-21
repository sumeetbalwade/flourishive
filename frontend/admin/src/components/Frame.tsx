import { brand } from '@flourishive/ui';
import type { ReactNode } from 'react';

/** Centered card layout for every signed-out screen. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="font-display text-4xl text-accent-hi">{brand.appName}</div>
          <p className="mt-1 text-sm text-muted">{brand.tagline}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
