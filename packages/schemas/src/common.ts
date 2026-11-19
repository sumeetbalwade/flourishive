import { z } from 'zod';

export const uuid = z.string().uuid();
export const email = z.string().trim().toLowerCase().email().max(191);

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
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date
    : null;
}

export const dateField = z
  .string()
  .refine((v) => parseDate(v) !== null, 'Use YYYY-MM-DD or DD/MM/YYYY');

/** Standard error body returned by the API (NestJS exception shape). */
export const apiErrorBody = z.object({
  statusCode: z.number().optional(),
  message: z.union([z.string(), z.array(z.string())]).optional(),
  error: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBody>;

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
