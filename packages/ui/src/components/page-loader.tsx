import { cn } from '../cn.ts';
import { BrandMark } from './auth-frame.tsx';

/**
 * The loading state for a whole page or app: the product mark inside orbiting rings and a soft glow,
 * with a sliding bar underneath. `fullscreen` fills the window (used before sign-in is known).
 */
export function PageLoader({
  label = 'Loading…',
  fullscreen,
}: {
  label?: string;
  fullscreen?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'grid place-content-center justify-items-center gap-7',
        fullscreen ? 'min-h-screen bg-bg' : 'min-h-[55vh]',
      )}
    >
      <div className="relative grid h-28 w-28 place-items-center">
        <span
          aria-hidden="true"
          className="absolute inset-3 animate-glow rounded-full bg-accent/40 blur-xl"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-2 border-accent/15"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent [animation-duration:1.1s]"
        />
        <span
          aria-hidden="true"
          className="absolute inset-3 animate-spin rounded-full border-2 border-transparent border-b-deep [animation-direction:reverse] [animation-duration:1.7s]"
        />
        <BrandMark size={48} />
      </div>
      <span
        aria-hidden="true"
        className="relative h-1 w-28 overflow-hidden rounded-full bg-accent-lo"
      >
        <span className="absolute inset-y-0 left-0 w-1/3 animate-bar rounded-full bg-accent" />
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
