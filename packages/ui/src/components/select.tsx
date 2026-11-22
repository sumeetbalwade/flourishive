import { Check, ChevronDown } from 'lucide-react';
import { Select as S } from 'radix-ui';
import { cn } from '../cn.ts';
import { item, panel } from './popover-styles.ts';

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
          'group flex h-11 w-full items-center justify-between gap-2 rounded-pill border border-line-strong bg-surface px-5 text-sm text-fg shadow-[0_1px_2px_rgb(17_32_27/0.04)]',
          'transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-accent/60 data-[placeholder]:text-faint',
          'focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)] data-[state=open]:border-accent data-[state=open]:shadow-[0_0_0_4px_var(--accent-lo)]',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown
            size={16}
            className="text-muted transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] group-data-[state=open]:rotate-180"
          />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            panel,
            'min-w-[var(--radix-select-trigger-width)] max-h-[min(320px,var(--radix-select-content-available-height))] overflow-hidden',
          )}
        >
          <S.Viewport className="max-h-[inherit] overflow-y-auto">
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} className={cn(item, 'justify-between')}>
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator>
                  <Check size={15} className="text-accent" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
