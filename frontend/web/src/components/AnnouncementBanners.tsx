import type { ActiveAnnouncement } from '@flourishive/schemas';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';

const TONE: Record<ActiveAnnouncement['tone'], string> = {
  INFO: 'bg-info-lo text-info',
  WARNING: 'bg-warning-lo text-warning',
  CRITICAL: 'bg-danger-lo text-danger',
};

const keyOf = (userId: string) => `fh.dismissed.${userId}`;
function dismissed(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Platform announcements above the page header. Dismissal is remembered per person on this device (D-70). */
export function AnnouncementBanners({ userId }: { userId: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.announcements.active(),
    enabled: Boolean(userId),
    refetchInterval: 5 * 60_000,
  });
  const [gone, setGone] = useState<string[]>(() => dismissed(userId));
  const shown = (q.data ?? []).filter((a) => !(a.dismissible && gone.includes(a.id)));
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-px">
      {shown.map((a) => (
        <div
          key={a.id}
          role={a.tone === 'CRITICAL' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${TONE[a.tone]}`}
        >
          <span>{a.message}</span>
          {a.dismissible ? (
            <button
              type="button"
              aria-label="Dismiss this notice"
              className="rounded p-1 hover:bg-black/10"
              onClick={() => {
                const next = [...gone, a.id];
                setGone(next);
                localStorage.setItem(keyOf(userId), JSON.stringify(next.slice(-50)));
              }}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
