import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { Popover } from 'radix-ui';
import { DayPicker } from 'react-day-picker';
import { cn } from '../cn.ts';

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  id,
}: {
  value?: Date;
  onChange: (d: Date | undefined) => void;
  placeholder?: string;
  id?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        id={id}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-pill border border-line-strong bg-surface-2 px-5 text-sm focus-visible:border-accent',
          value ? 'text-fg' : 'text-faint',
        )}
      >
        {value ? format(value, 'dd MMM yyyy') : placeholder}
        <CalendarDays size={16} className="text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 rounded-card border border-line bg-surface-raised p-3 text-sm text-fg shadow-card [--rdp-accent-color:var(--accent)] [--rdp-accent-background-color:var(--accent-lo)]"
        >
          <DayPicker mode="single" selected={value} onSelect={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
