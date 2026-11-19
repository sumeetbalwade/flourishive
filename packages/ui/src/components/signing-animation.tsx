import { cn } from '../cn.ts';

export type SigningState = 'idle' | 'signing' | 'waiting' | 'done' | 'failed';

const LABEL: Record<SigningState, string> = {
  idle: 'Ready to sign',
  signing: 'Signing',
  waiting: 'Waiting for the token',
  done: 'Signed',
  failed: 'Signing failed',
};

/**
 * Pen-stroke and checkmark (D-37). It follows the real signing state passed in
 * by the caller, never a timer. With reduced motion the final frame is shown
 * statically and the label carries the state.
 *
 * Batch use: render one per document, or pass `progress` (0-1) to fill the line.
 */
export function SigningAnimation({
  state,
  progress,
  size = 96,
  className,
}: {
  state: SigningState;
  progress?: number;
  size?: number;
  className?: string;
}) {
  const drawn =
    state === 'done'
      ? 1
      : state === 'signing'
        ? (progress ?? 0.65)
        : state === 'waiting'
          ? 0.35
          : state === 'failed'
            ? 0.5
            : 0;
  const color =
    state === 'failed' ? 'var(--danger)' : state === 'done' ? 'var(--success)' : 'var(--accent)';
  return (
    <span
      role="img"
      aria-label={LABEL[state]}
      className={cn('inline-grid place-items-center', className)}
    >
      <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <circle cx="48" cy="48" r="44" stroke="var(--border-strong)" strokeWidth="2" />
        {state === 'done' ? (
          <circle
            cx="48"
            cy="48"
            r="44"
            stroke={color}
            strokeWidth="2"
            fill={color}
            fillOpacity="0.12"
          />
        ) : null}
        {/* the signature line */}
        <path
          d="M20 58 C 26 34, 34 34, 36 52 S 44 70, 50 50 S 60 36, 64 52 S 72 62, 78 46"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={state === 'done' ? 1 : 1 - drawn}
          opacity={state === 'done' ? 0 : 1}
          className={cn(
            'transition-[stroke-dashoffset,opacity] duration-[var(--dur-slow)] ease-[var(--ease-out)]',
            state === 'waiting' && 'motion-safe:animate-pulse',
          )}
        />
        {/* the checkmark it settles into */}
        <path
          d="M30 50 L43 63 L68 36"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={state === 'done' ? 0 : 1}
          className="transition-[stroke-dashoffset] delay-150 duration-[var(--dur-slow)] ease-[var(--ease-out)]"
        />
        {state === 'failed' ? (
          <path
            d="M62 62 L74 74 M74 62 L62 74"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </span>
  );
}
