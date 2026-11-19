import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();
const email = z.string().trim().toLowerCase().email().max(191);

/** Accepts 2026-04-01, 01/04/2026 and 01-04-2026 (Indian spreadsheets use day first). */
export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [+match[1]!, +match[2]!, +match[3]!];
  else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)))
    [d, m, y] = [+match[1]!, +match[2]!, +match[3]!];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? date
    : null;
}

const dateField = z
  .string()
  .refine((v) => parseDate(v) !== null, 'Use YYYY-MM-DD or DD/MM/YYYY');

export const personFields = z.object({
  firstName: text(100),
  lastName: text(100),
  workEmail: email.nullish(),
  personalEmail: email.nullish(),
  phone: optText(32),
});

export const engagementFields = z.object({
  entityId: z.string().uuid(),
  type: z.enum(['EMPLOYEE', 'INTERN']),
  employeeCode: text(32),
  departmentId: z.string().uuid().nullish(),
  designationId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  managerId: z.string().uuid().nullish(),
  startDate: dateField,
  endDate: dateField.nullish(),
});

export const internFields = z.object({
  college: optText(191),
  course: optText(191),
  graduationYear: z.number().int().min(1990).max(2100).nullish(),
});

export const createPersonBody = z.object({
  /** Attach a new engagement to someone who already exists (e.g. an intern becoming an employee). */
  personId: z.string().uuid().optional(),
  person: personFields.optional(),
  engagement: engagementFields,
  intern: internFields.optional(),
});

export const updatePersonBody = z.object({
  person: personFields.partial().optional(),
  engagement: engagementFields
    .omit({ entityId: true })
    .partial()
    .extend({ status: z.enum(['ACTIVE', 'ENDED']).optional() })
    .optional(),
  intern: internFields.optional(),
});

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['EMPLOYEE', 'INTERN']).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
  departmentId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
