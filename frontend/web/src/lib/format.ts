import type { Engagement } from '@flourishive/schemas';

export const fullName = (e: Pick<Engagement, 'person'>) =>
  `${e.person.firstName} ${e.person.lastName}`;

/** Dates come as UTC midnight; show them in UTC so 01 Apr never becomes 31 Mar. */
export const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';
