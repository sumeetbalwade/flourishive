import type { Engagement } from '@flourishive/schemas';

export const fullName = (e: Pick<Engagement, 'person'>) =>
  `${e.person.firstName} ${e.person.lastName}`;

/** Dates, times, numbers and money follow the company's region settings (D-69). */
export { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtTime } from '@flourishive/ui';
