import { parseDate, type FieldDef } from '@flourishive/schemas';

export const BUILT_IN = ['reference', 'issueDate'] as const;

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const longDate = (d: Date) =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** Checks supplied values against the field list and returns them ready to print. */
export function resolveValues(
  fields: FieldDef[],
  given: Record<string, string>,
): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const f of fields) {
    const raw = (given[f.key] ?? '').trim();
    if (!raw) {
      if (f.required) errors.push(`${f.label} is required`);
      values[f.key] = '';
      continue;
    }
    if (f.type === 'date') {
      const d = parseDate(raw);
      if (!d) errors.push(`${f.label} must be a date (YYYY-MM-DD)`);
      values[f.key] = d ? longDate(d) : raw;
    } else if (f.type === 'number') {
      if (Number.isNaN(Number(raw.replaceAll(',', ''))))
        errors.push(`${f.label} must be a number`);
      values[f.key] = raw;
    } else if (f.type === 'amount') {
      const n = Number(raw.replaceAll(',', ''));
      if (Number.isNaN(n)) errors.push(`${f.label} must be an amount`);
      // Indian digit grouping: 14,50,000
      values[f.key] = Number.isNaN(n)
        ? raw
        : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    } else values[f.key] = raw;
  }
  return { values, errors };
}

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_, k: string) => values[k] ?? '');
}
