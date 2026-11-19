import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn.ts';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay = 'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in';

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface p-6 shadow-card',
          className,
        )}
      >
        <D.Title className="font-display text-2xl text-fg">{title}</D.Title>
        {description ? (
          <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        <div className="mt-5">{children}</div>
        <D.Close
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-pill text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X size={16} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

/** Side panel, same primitive as Dialog, docked right. */
export function SheetContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-line bg-surface p-6 shadow-card',
          className,
        )}
      >
        <D.Title className="font-display text-2xl text-fg">{title}</D.Title>
        {description ? (
          <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        <div className="mt-5">{children}</div>
        <D.Close
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-pill text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X size={16} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
