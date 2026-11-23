import { Search, X } from 'lucide-react';
import { cn } from '../cn.ts';

/** A search field with a clear button. Used above long lists and settings pages. */
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search',
  label = 'Search',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={16}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
      />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-pill border border-line-strong bg-surface pl-10 pr-10 text-sm text-fg placeholder:text-faint hover:border-accent/60 focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-pill text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
