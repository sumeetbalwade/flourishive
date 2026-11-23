import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../cn.ts';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';

const storeKey = (id: string) => `fh-section:${id}`;
function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(storeKey(id));
    return v === null ? fallback : v === 'open';
  } catch {
    return fallback;
  }
}

/**
 * A card whose body folds away. Open or closed is remembered per device. It can carry its own
 * Save and Discard bar so everything in one section is saved together.
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  actions,
  open: forcedOpen,
  forceToken,
  defaultOpen = false,
  dirtyCount = 0,
  saving = false,
  onSave,
  onDiscard,
  children,
}: {
  /** Stable id: used for the remembered state and as the page anchor (`#section-<id>`). */
  id: string;
  title: string;
  /** Small text next to the title, e.g. "3 of 6 set". */
  summary?: ReactNode;
  /** Buttons on the right of the header, e.g. a Test button. */
  actions?: ReactNode;
  /** When set, overrides the remembered state (search results, deep links). */
  open?: boolean;
  /** Change this to apply `open` again even when its value did not change (Expand all / Collapse all). */
  forceToken?: number;
  defaultOpen?: boolean;
  /** Number of unsaved changes in this section. */
  dirtyCount?: number;
  saving?: boolean;
  onSave?: () => void | Promise<void>;
  onDiscard?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  useEffect(() => {
    if (forcedOpen !== undefined) setOpen(forcedOpen);
  }, [forcedOpen, forceToken]);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(storeKey(id), o ? 'closed' : 'open');
      } catch {
        /* the choice just is not remembered */
      }
      return !o;
    });
  const bodyId = `section-body-${id}`;

  return (
    <section
      id={`section-${id}`}
      aria-label={title}
      className="scroll-mt-28 rounded-card border border-line bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-pill text-left"
        >
          <ChevronDown
            size={18}
            className={cn(
              'shrink-0 text-muted transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]',
              !open && '-rotate-90',
            )}
          />
          <span className="font-display text-lg font-medium text-fg">{title}</span>
          {summary ? <span className="text-xs text-faint">{summary}</span> : null}
          {dirtyCount > 0 ? <Badge tone="warning">{dirtyCount} unsaved</Badge> : null}
        </button>
        {actions}
      </div>
      {open ? (
        <div id={bodyId} className="animate-fade-in border-t border-line px-5">
          {children}
          {onSave ? (
            <div
              className={cn(
                'sticky bottom-3 -mx-2 my-3 flex items-center justify-end gap-2 rounded-pill border border-line bg-surface/95 px-3 py-2 shadow-pop backdrop-blur transition-opacity',
                dirtyCount === 0 && 'pointer-events-none opacity-0',
              )}
              aria-hidden={dirtyCount === 0}
            >
              <span className="mr-auto pl-2 text-xs text-muted">
                {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'} in {title}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDiscard}
                disabled={saving || dirtyCount === 0}
              >
                Discard
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={saving || dirtyCount === 0}
                onClick={() => void onSave()}
              >
                Save {title.toLowerCase()}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
