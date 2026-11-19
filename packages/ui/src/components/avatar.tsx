import { Avatar as RadixAvatar } from 'radix-ui';
import { cn } from '../cn.ts';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  return (
    <RadixAvatar.Root
      className={cn(
        'inline-grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-pill bg-surface-raised text-xs font-semibold text-accent-hi',
        className,
      )}
    >
      {src ? (
        <RadixAvatar.Image src={src} alt={name} className="h-full w-full object-cover" />
      ) : null}
      <RadixAvatar.Fallback delayMs={src ? 300 : 0}>{initials(name)}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
