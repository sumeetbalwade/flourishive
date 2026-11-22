import { Toast as T } from 'radix-ui';
import { createContext, use, useCallback, useState, type ReactNode } from 'react';
import { cn } from '../cn.ts';

type Tone = 'success' | 'danger' | 'info';
type Item = { id: number; title: string; description?: string; tone: Tone };
const Ctx = createContext<(t: Omit<Item, 'id'>) => void>(() => {});

export const useToast = () => use(Ctx);

const bar: Record<Tone, string> = { success: 'bg-success', danger: 'bg-danger', info: 'bg-info' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const push = useCallback(
    (t: Omit<Item, 'id'>) => setItems((s) => [...s, { ...t, id: Date.now() + Math.random() }]),
    [],
  );
  return (
    <Ctx value={push}>
      <T.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((i) => (
          <T.Root
            key={i.id}
            onOpenChange={(o) => !o && setItems((s) => s.filter((x) => x.id !== i.id))}
            className="relative flex gap-3 overflow-hidden rounded-md border border-line-strong bg-surface-raised py-3.5 pl-6 pr-4 shadow-pop data-[state=open]:animate-[toast-in_280ms_var(--ease-out)] data-[state=closed]:animate-fade-out data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-[toast-swipe_150ms_ease-out_forwards]"
          >
            <span className={cn('absolute inset-y-2 left-2 w-1 rounded-full', bar[i.tone])} />
            <div className="grid gap-0.5">
              <T.Title className="text-sm font-medium text-fg">{i.title}</T.Title>
              {i.description ? (
                <T.Description className="text-xs text-muted">{i.description}</T.Description>
              ) : null}
            </div>
          </T.Root>
        ))}
        <T.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none" />
      </T.Provider>
    </Ctx>
  );
}
