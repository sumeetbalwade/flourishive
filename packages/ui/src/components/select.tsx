import { Check, ChevronDown } from 'lucide-react';
import { Select as S } from 'radix-ui';
import { cn } from '../cn.ts';

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  id,
  className,
}: {
  value?: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger
        id={id}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-pill border border-line-strong bg-surface-2 px-5 text-sm text-fg data-[placeholder]:text-faint focus-visible:border-accent',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown size={16} className="text-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface-raised p-1 shadow-card"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-sm text-fg outline-none data-[highlighted]:bg-accent-lo data-[highlighted]:text-accent-hi"
              >
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator>
                  <Check size={14} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
