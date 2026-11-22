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
          'flex h-11 w-full items-center justify-between gap-2 rounded-pill border border-line-strong bg-surface px-5 text-sm shadow-[0_1px_2px_rgb(17_32_27/0.04)] transition-[border-color,box-shadow] hover:border-accent/60 focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)] data-[state=open]:border-accent',
          value ? 'text-fg' : 'text-faint',
        )}
      >
        {value ? format(value, 'dd MMM yyyy') : placeholder}
        <CalendarDays size={16} className="text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          className="z-50 origin-[var(--radix-popper-transform-origin)] rounded-card border border-line-strong bg-surface-raised p-4 text-sm text-fg shadow-pop data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out [--rdp-accent-color:var(--accent)] [--rdp-accent-background-color:var(--accent-lo)]"
        >
          <DayPicker mode="single" selected={value} onSelect={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
