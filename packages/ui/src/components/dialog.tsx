import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn.ts';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay =
  'fixed inset-0 z-40 bg-[#07110d]/50 backdrop-blur-[6px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out';

const closeBtn =
  'absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-pill text-muted transition-colors hover:bg-surface-2 hover:text-fg active:scale-95';

type Props = { title: string; description?: string; children?: ReactNode; className?: string };

function Header({ title, description }: Pick<Props, 'title' | 'description'>) {
  return (
    <>
      <D.Title className="pr-10 font-display text-2xl font-medium text-fg">{title}</D.Title>
      {description ? (
        <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
      ) : (
        <D.Description className="sr-only">{title}</D.Description>
      )}
    </>
  );
}

export function DialogContent({ title, description, children, className }: Props) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      {/* Centred by layout, not by a transform, so the entrance animation can never start off-centre. */}
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <D.Content
          className={cn(
            'pointer-events-auto relative max-h-[calc(100dvh-32px)] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-7 shadow-pop will-change-transform',
            'data-[state=open]:animate-[dialog-in_320ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[dialog-out_160ms_var(--ease-out)_forwards]',
            className,
          )}
        >
          <Header title={title} description={description} />
          <div className="mt-5">{children}</div>
          <D.Close aria-label="Close" className={closeBtn}>
            <X size={17} />
          </D.Close>
        </D.Content>
      </div>
    </D.Portal>
  );
}

/** Side panel, same primitive as Dialog, docked right. */
export function SheetContent({ title, description, children, className }: Props) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'fixed inset-y-3 right-3 z-50 w-[calc(100%-24px)] max-w-md overflow-y-auto rounded-card border border-line bg-surface p-7 shadow-pop',
          'data-[state=open]:animate-[sheet-in_340ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-sheet-out',
          className,
        )}
      >
        <Header title={title} description={description} />
        <div className="mt-5">{children}</div>
        <D.Close aria-label="Close" className={closeBtn}>
          <X size={17} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
