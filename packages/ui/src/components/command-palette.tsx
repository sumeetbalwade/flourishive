import { Search } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { cn } from '../cn.ts';

export interface Command {
  id: string;
  label: string;
  /** Shown on the right, e.g. the menu group or "Action". */
  hint?: string;
  icon?: ComponentType<{ size?: number }>;
  run: () => void;
}

/** Cmd/Ctrl+K search over pages and actions. Arrow keys move, Enter runs, Esc closes. */
export function CommandPalette({
  commands,
  open,
  onOpenChange,
  placeholder = 'Search pages and actions',
}: {
  commands: Command[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
    }
  }, [open]);
  useEffect(() => setSel(0), [query]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    c.run();
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <D.Content
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-line-strong bg-surface shadow-card"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(shown[sel]);
            }
          }}
        >
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Find a page or an action</D.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={18} className="text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label="Search"
              className="h-14 w-full bg-transparent text-base text-fg outline-none focus-visible:shadow-none placeholder:text-faint"
            />
          </div>
          <ul role="listbox" aria-label="Results" className="max-h-80 overflow-auto p-2">
            {shown.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === sel}>
                <button
                  type="button"
                  onClick={() => run(c)}
                  onMouseMove={() => setSel(i)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm',
                    i === sel ? 'bg-accent-lo text-accent-hi' : 'text-fg',
                  )}
                >
                  {c.icon ? <c.icon size={18} /> : null}
                  <span>{c.label}</span>
                  {c.hint ? <span className="ml-auto text-xs text-faint">{c.hint}</span> : null}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted">Nothing found.</li>}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
