import { FileSignature, ShieldCheck, Users } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { brand } from '../brand.ts';

const POINTS = [
  { icon: Users, text: 'One home for every employee and intern record' },
  { icon: FileSignature, text: 'Letters drafted, approved and e-signed in minutes' },
  { icon: ShieldCheck, text: 'Role-based access with two-step sign-in' },
];

const YEAR = new Date().getFullYear();
const EASE = [0.22, 1, 0.36, 1] as const;

/** The round product mark used in the sidebar and on signed-out screens. */
export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-accent font-display font-semibold text-on-accent shadow-press"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {brand.appName.charAt(0).toUpperCase()}
    </span>
  );
}

/** Split layout for every signed-out screen: brand panel on the left, the form on the right. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-deep p-12 text-on-deep lg:flex lg:flex-col lg:justify-between">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, 24, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-16 h-[28rem] w-[28rem] rounded-full bg-deep-hi blur-3xl"
          animate={{ x: [0, 36, 0], y: [0, -28, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <span className="font-display text-2xl font-medium">{brand.appName}</span>
        </div>
        <div className="relative max-w-md">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="font-display text-5xl font-light leading-[1.1] tracking-tight"
          >
            {brand.tagline}
          </motion.h2>
          <ul className="mt-10 grid gap-3">
            {POINTS.map(({ icon: Icon, text }, i) => (
              <motion.li
                key={text}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.12, duration: 0.5, ease: EASE }}
                className="flex items-center gap-4 rounded-pill bg-white/10 py-2.5 pl-2.5 pr-6 text-sm backdrop-blur-sm"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15">
                  <Icon size={17} />
                </span>
                {text}
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-on-deep/60">
          © {YEAR} {brand.appName}
        </p>
      </aside>
      <main className="grid place-items-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="w-full max-w-md"
        >
          <div className="mb-8 text-center lg:hidden">
            <div className="font-display text-4xl font-medium text-accent-hi">{brand.appName}</div>
            <p className="mt-1 text-sm text-muted">{brand.tagline}</p>
          </div>
          {children}
        </motion.div>
      </main>
    </div>
  );
}
