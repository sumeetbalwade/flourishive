/**
 * Dates, numbers and money, in the company's own style (D-69). The app sets the region once after
 * sign-in; every screen then formats through these helpers instead of calling Intl itself.
 */
export interface Region {
  timeZone: string;
  dateFormat: 'DD MMM YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  numberGrouping: 'indian' | 'international';
  currency: string;
  fyStartMonth: number;
  weekStart: 'monday' | 'sunday' | 'saturday';
}

export const DEFAULT_REGION: Region = {
  timeZone: 'Asia/Kolkata',
  dateFormat: 'DD MMM YYYY',
  numberGrouping: 'indian',
  currency: 'INR',
  fyStartMonth: 4,
  weekStart: 'monday',
};

let region: Region = DEFAULT_REGION;

/** Takes the `region.*` values from the settings response. Unknown or missing values keep the default. */
export function setRegion(values: Record<string, unknown>): void {
  const pick = <K extends keyof Region>(k: K): Region[K] =>
    (values[`region.${k}`] as Region[K] | undefined) ?? DEFAULT_REGION[k];
  region = {
    timeZone: pick('timeZone'),
    dateFormat: pick('dateFormat'),
    numberGrouping: pick('numberGrouping'),
    currency: pick('currency'),
    fyStartMonth: pick('fyStartMonth'),
    weekStart: pick('weekStart'),
  };
}
export const getRegion = (): Region => region;

const locale = () => (region.numberGrouping === 'indian' ? 'en-IN' : 'en-US');

function parts(d: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  const month = new Intl.DateTimeFormat('en-GB', { timeZone, month: '2-digit' }).format(d);
  return { dd: get('day'), mmm: get('month'), mm: month, yyyy: get('year') };
}

function dateText(d: Date, timeZone: string): string {
  const p = parts(d, timeZone);
  if (region.dateFormat === 'DD/MM/YYYY') return `${p.dd}/${p.mm}/${p.yyyy}`;
  if (region.dateFormat === 'YYYY-MM-DD') return `${p.yyyy}-${p.mm}-${p.dd}`;
  return `${p.dd} ${p.mmm} ${p.yyyy}`;
}

/** A calendar date with no time of day (a start date). Shown as is, in UTC, so 01 Apr never becomes 31 Mar. */
export const fmtDate = (iso: string | Date | null | undefined): string =>
  iso ? dateText(new Date(iso), 'UTC') : '—';

/** A moment in time, in the company's zone: date then time. */
export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: region.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${dateText(d, region.timeZone)}, ${time}`;
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: region.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const fmtNumber = (n: number, maximumFractionDigits = 2): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits }).format(n);

export const fmtMoney = (n: number): string =>
  new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: region.currency,
    maximumFractionDigits: 2,
  }).format(n);

/** "FY 2026-27" for the financial year a date falls in. */
export function fiscalYear(d: Date | string): string {
  const x = new Date(d);
  const startsThisYear = x.getUTCMonth() + 1 >= region.fyStartMonth;
  const y =
    region.fyStartMonth === 1
      ? x.getUTCFullYear()
      : startsThisYear
        ? x.getUTCFullYear()
        : x.getUTCFullYear() - 1;
  return region.fyStartMonth === 1
    ? `FY ${y}`
    : `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
