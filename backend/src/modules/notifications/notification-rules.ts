import { localClock } from '../logs/alerts.service.js';

/**
 * The events a company can switch on and off per role (D-69). Credentials, one-time codes and security
 * notices are not here on purpose: they can never be turned off or held back.
 */
export interface RuleEvent {
  key: string;
  label: string;
  description: string;
  /** The person the event is about can be told too. */
  subject: boolean;
  /** Roles told by default (email). */
  defaultRoles: string[];
}

export const RULE_EVENTS: RuleEvent[] = [
  {
    key: 'letter.issued',
    label: 'A letter is issued',
    description: 'A new letter has been generated',
    subject: true,
    defaultRoles: ['hr_lead', 'tenant_admin'],
  },
  {
    key: 'letter.declined',
    label: 'A signer declines a letter',
    description: 'Someone refused to sign, or the request ran out',
    subject: false,
    defaultRoles: ['hr_lead', 'tenant_admin'],
  },
  {
    key: 'approval.reminder',
    label: 'A letter is still waiting for approval',
    description: 'A reminder, sent after the hours chosen under reminders',
    subject: false,
    defaultRoles: ['hr_lead', 'tenant_admin'],
  },
];

export const SUBJECT = 'SUBJECT';

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

const minutesOf = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * How long to hold a non-urgent email so it goes out when quiet hours end, in the company's zone.
 * Returns 0 when it can go now. Handles a window that crosses midnight (22:00 to 07:00).
 */
export function quietDelayMs(now: Date, zone: string, q: QuietHours): number {
  if (!q.enabled || q.start === q.end) return 0;
  const { hour } = localClock(now, zone);
  // Minutes into the local day, using the zone's own clock.
  const minute = Number(
    new Intl.DateTimeFormat('en', { timeZone: zone, minute: '2-digit' }).format(
      now,
    ),
  );
  const at = hour * 60 + minute;
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  const inside =
    start < end ? at >= start && at < end : at >= start || at < end;
  if (!inside) return 0;
  const wait = (end - at + 1440) % 1440;
  return (wait === 0 ? 1440 : wait) * 60_000;
}
