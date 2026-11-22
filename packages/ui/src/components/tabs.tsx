import { motion } from 'motion/react';
import { Tabs as T } from 'radix-ui';
import { createContext, use, useId, useState, type ComponentProps } from 'react';
import { cn } from '../cn.ts';

const Ctx = createContext<{ id: string; value?: string }>({ id: '' });

/** Radix Tabs; the active pill slides between triggers (shared layout animation). */
export function Tabs({ value, defaultValue, onValueChange, ...p }: ComponentProps<typeof T.Root>) {
  const id = useId();
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  return (
    <Ctx value={{ id, value: current }}>
      <T.Root
        value={current}
        onValueChange={(v) => {
          setInner(v);
          onValueChange?.(v);
        }}
        {...p}
      />
    </Ctx>
  );
}

export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn(
        'inline-flex gap-1 rounded-pill border border-line bg-surface p-1 shadow-card',
        className,
      )}
      {...p}
    />
  );
}

export function TabsTrigger({
  className,
  children,
  value,
  ...p
}: ComponentProps<typeof T.Trigger>) {
  const ctx = use(Ctx);
  const active = ctx.value === value;
  return (
    <T.Trigger
      value={value}
      className={cn(
        'relative h-9 rounded-pill px-4 text-[13px] font-medium text-muted transition-colors duration-[var(--dur-fast)] hover:text-fg active:scale-[0.97] data-[state=active]:text-on-accent',
        className,
      )}
      {...p}
    >
      {active && (
        <motion.span
          layoutId={`tab-${ctx.id}`}
          aria-hidden="true"
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          className="absolute inset-0 rounded-pill bg-accent shadow-press"
        />
      )}
      <span className="relative">{children}</span>
    </T.Trigger>
  );
}

export const TabsContent = ({ className, ...p }: ComponentProps<typeof T.Content>) => (
  <T.Content className={cn('data-[state=active]:animate-fade-in', className)} {...p} />
);
