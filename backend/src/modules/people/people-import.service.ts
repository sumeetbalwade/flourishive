import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { AccessService } from '../access/access.service.js';
import type { AccessClaims } from '../identity/token.service.js';
import { parseDate } from './people.schemas.js';

export const MAX_IMPORT_ROWS = 2000;

const REQUIRED = [
  'employee_code',
  'first_name',
  'last_name',
  'type',
  'start_date',
] as const;
const KNOWN = [
  ...REQUIRED,
  'work_email',
  'personal_email',
  'phone',
  'entity',
  'department',
  'designation',
  'location',
  'manager_code',
  'end_date',
  'college',
  'course',
  'graduation_year',
] as const;

const cell = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const rowSchema = z.object({
  employee_code: z.string().trim().min(1).max(32),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  type: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['employee', 'intern'])),
  start_date: z
    .string()
    .trim()
    .refine((v) => parseDate(v) !== null, 'Use YYYY-MM-DD or DD/MM/YYYY'),
  end_date: cell.refine(
    (v) => v === undefined || parseDate(v) !== null,
    'Use YYYY-MM-DD or DD/MM/YYYY',
  ),
  work_email: cell
    .transform((v) => v?.toLowerCase())
    .pipe(z.string().email().max(191).optional()),
  personal_email: cell
    .transform((v) => v?.toLowerCase())
    .pipe(z.string().email().max(191).optional()),
  phone: cell.pipe(z.string().max(32).optional()),
  entity: cell,
  department: cell.pipe(z.string().max(100).optional()),
  designation: cell.pipe(z.string().max(100).optional()),
  location: cell.pipe(z.string().max(100).optional()),
  manager_code: cell,
  college: cell.pipe(z.string().max(191).optional()),
  course: cell.pipe(z.string().max(191).optional()),
  graduation_year: cell
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().min(1990).max(2100).optional()),
});
type Row = z.infer<typeof rowSchema>;

export interface ImportIssue {
  line: number;
  field?: string;
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: boolean;
  errors: ImportIssue[];
  willCreate: {
    people: number;
    departments: string[];
    designations: string[];
    locations: string[];
  };
  willUpdate: { people: number };
  committed: boolean;
}

interface PlannedRow {
  line: number;
  row: Row;
  entityId: string;
  existingEngagementId?: string;
  existingPersonId?: string;
}

const key = (s: string) => s.trim().toLowerCase();

/** Turns a validation issue into a sentence a person fixing a spreadsheet can act on. */
function friendlyIssue(issue: z.core.$ZodIssue): string {
  const i = issue as {
    code: string;
    origin?: string;
    minimum?: number;
    maximum?: number;
    format?: string;
    message: string;
  };
  if (i.code === 'too_small' && i.origin === 'string' && i.minimum === 1)
    return 'Required';
  if (i.code === 'invalid_type') return 'Required';
  if (i.code === 'too_big' && i.origin === 'string')
    return `Too long (at most ${i.maximum} characters)`;
  if (i.code === 'invalid_format' && i.format === 'email')
    return 'Not a valid email address';
  if (i.code === 'invalid_value') return 'Must be employee or intern';
  if (i.code === 'too_small' || i.code === 'too_big')
    return 'Out of the allowed range';
  return i.message;
}

@Injectable()
export class PeopleImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async run(
    a: Pick<AccessClaims, 'tenantId' | 'userId'>,
    csv: string,
    opts: { dryRun: boolean; createMissing: boolean },
  ): Promise<ImportResult> {
    const scope = await this.access.entityScope(
      a.tenantId,
      a.userId,
      'people.import',
    );
    if (!scope) throw new ForbiddenException();

    const records = this.parseCsv(csv);
    const errors: ImportIssue[] = [];
    const result: ImportResult = {
      dryRun: opts.dryRun,
      totalRows: records.length,
      valid: false,
      errors,
      willCreate: {
        people: 0,
        departments: [],
        designations: [],
        locations: [],
      },
      willUpdate: { people: 0 },
      committed: false,
    };

    return runInTenant(a.tenantId, async () => {
      const db = this.prisma.db;
      const [entities, departments, designations, locations, engagements] =
        await Promise.all([
          db.entity.findMany(),
          db.department.findMany(),
          db.designation.findMany(),
          db.location.findMany(),
          db.engagement.findMany({
            select: { id: true, personId: true, employeeCode: true },
          }),
        ]);
      const byName = <T extends { name: string }>(rows: T[]) =>
        new Map(rows.map((r) => [key(r.name), r]));
      const entityByName = byName(entities),
        deptByName = byName(departments);
      const desByName = byName(designations),
        locByName = byName(locations);
      const existing = new Map(
        engagements.map((e) => [e.employeeCode.toLowerCase(), e]),
      );

      const planned: PlannedRow[] = [];
      const seenCodes = new Map<string, number>();
      const seenEmails = new Map<string, number>();
      const missing = {
        departments: new Set<string>(),
        designations: new Set<string>(),
        locations: new Set<string>(),
      };

      records.forEach((raw, i) => {
        const line = i + 2; // header is line 1
        const parsed = rowSchema.safeParse(raw);
        if (!parsed.success) {
          for (const issue of parsed.error.issues)
            errors.push({
              line,
              field: String(issue.path[0] ?? ''),
              message: friendlyIssue(issue),
            });
          return;
        }
        const row = parsed.data;
        const code = key(row.employee_code);
        if (seenCodes.has(code))
          errors.push({
            line,
            field: 'employee_code',
            message: `Repeats line ${seenCodes.get(code)}`,
          });
        seenCodes.set(code, line);
        if (row.work_email) {
          const prev = seenEmails.get(row.work_email);
          if (prev)
            errors.push({
              line,
              field: 'work_email',
              message: `Repeats line ${prev}`,
            });
          seenEmails.set(row.work_email, line);
        }

        // Company: required unless the tenant has exactly one.
        const entity = row.entity
          ? entityByName.get(key(row.entity))
          : entities.length === 1
            ? entities[0]
            : undefined;
        if (!entity) {
          errors.push({
            line,
            field: 'entity',
            message: row.entity
              ? `Unknown company "${row.entity}"`
              : 'Company is required',
          });
          return;
        }
        if (scope !== '*' && !scope.includes(entity.id)) {
          errors.push({
            line,
            field: 'entity',
            message: 'You cannot import into that company',
          });
          return;
        }
        for (const [field, value, map, bag] of [
          ['department', row.department, deptByName, missing.departments],
          ['designation', row.designation, desByName, missing.designations],
          ['location', row.location, locByName, missing.locations],
        ] as const) {
          if (value && !map.has(key(value))) {
            if (opts.createMissing) bag.add(value);
            else
              errors.push({
                line,
                field,
                message: `Unknown ${field} "${value}" (re-run with create missing to add it)`,
              });
          }
        }
        if (
          row.type === 'employee' &&
          (row.college || row.course || row.graduation_year)
        ) {
          errors.push({
            line,
            field: 'type',
            message: 'College details only apply to interns',
          });
        }
        const ex = existing.get(code);
        planned.push({
          line,
          row,
          entityId: entity.id,
          existingEngagementId: ex?.id,
          existingPersonId: ex?.personId,
        });
      });

      // Managers must be in this file or already exist.
      for (const p of planned) {
        const m = p.row.manager_code;
        if (m && !seenCodes.has(key(m)) && !existing.has(key(m))) {
          errors.push({
            line: p.line,
            field: 'manager_code',
            message: `Unknown manager code "${m}"`,
          });
        }
        if (m && key(m) === key(p.row.employee_code))
          errors.push({
            line: p.line,
            field: 'manager_code',
            message: 'Cannot report to themselves',
          });
      }

      result.willCreate = {
        people: planned.filter((p) => !p.existingEngagementId).length,
        departments: [...missing.departments],
        designations: [...missing.designations],
        locations: [...missing.locations],
      };
      result.willUpdate = {
        people: planned.filter((p) => p.existingEngagementId).length,
      };
      result.errors.sort((x, y) => x.line - y.line);
      result.valid = errors.length === 0;
      if (opts.dryRun || !result.valid) return result;

      await this.commit(a.tenantId, planned, {
        missing,
        deptByName,
        desByName,
        locByName,
      });
      result.committed = true;
      return result;
    });
  }

  private parseCsv(csv: string): Record<string, string>[] {
    let records: Record<string, string>[];
    try {
      records = parse(csv, {
        columns: (header: string[]) =>
          header.map((h) =>
            h
              .trim()
              .toLowerCase()
              .replace(/[\s-]+/g, '_'),
          ),
        skip_empty_lines: true,
        bom: true,
        trim: true,
        relax_column_count: false,
      });
    } catch (e) {
      throw new BadRequestException(
        `Could not read the CSV: ${(e as Error).message}`,
      );
    }
    if (records.length === 0)
      throw new BadRequestException('The CSV has no rows');
    if (records.length > MAX_IMPORT_ROWS)
      throw new PayloadTooLargeException(
        `At most ${MAX_IMPORT_ROWS} rows per import`,
      );
    const headers = Object.keys(records[0]!);
    const missing = REQUIRED.filter((h) => !headers.includes(h));
    if (missing.length)
      throw new BadRequestException(`Missing column(s): ${missing.join(', ')}`);
    const unknown = headers.filter(
      (h) => !(KNOWN as readonly string[]).includes(h),
    );
    if (unknown.length)
      throw new BadRequestException(`Unknown column(s): ${unknown.join(', ')}`);
    return records;
  }

  /** All or nothing: one database transaction, catalogue entries first, managers last. */
  private async commit(
    tenantId: string,
    planned: PlannedRow[],
    ctx: {
      missing: {
        departments: Set<string>;
        designations: Set<string>;
        locations: Set<string>;
      };
      deptByName: Map<string, { id: string }>;
      desByName: Map<string, { id: string }>;
      locByName: Map<string, { id: string }>;
    },
  ) {
    await this.prisma.db.$transaction(async (tx) => {
      for (const name of ctx.missing.departments)
        ctx.deptByName.set(
          key(name),
          await tx.department.create({ data: { tenantId, name } }),
        );
      for (const name of ctx.missing.designations)
        ctx.desByName.set(
          key(name),
          await tx.designation.create({ data: { tenantId, name } }),
        );
      for (const name of ctx.missing.locations)
        ctx.locByName.set(
          key(name),
          await tx.location.create({ data: { tenantId, name } }),
        );

      const engagementByCode = new Map<string, string>();
      for (const p of planned) {
        const r = p.row;
        const personData = {
          firstName: r.first_name,
          lastName: r.last_name,
          workEmail: r.work_email ?? null,
          personalEmail: r.personal_email ?? null,
          phone: r.phone ?? null,
        };
        const engData = {
          entityId: p.entityId,
          type:
            r.type === 'intern' ? ('INTERN' as const) : ('EMPLOYEE' as const),
          departmentId: r.department
            ? ctx.deptByName.get(key(r.department))!.id
            : null,
          designationId: r.designation
            ? ctx.desByName.get(key(r.designation))!.id
            : null,
          locationId: r.location
            ? ctx.locByName.get(key(r.location))!.id
            : null,
          startDate: parseDate(r.start_date)!,
          endDate: r.end_date ? parseDate(r.end_date) : null,
          status:
            r.end_date && parseDate(r.end_date)! < new Date()
              ? ('ENDED' as const)
              : ('ACTIVE' as const),
        };
        let engagementId = p.existingEngagementId;
        try {
          if (engagementId) {
            await tx.person.update({
              where: { id: p.existingPersonId! },
              data: personData,
            });
            await tx.engagement.update({
              where: { id: engagementId },
              data: engData,
            });
          } else {
            const person = await tx.person.create({
              data: { tenantId, ...personData },
            });
            engagementId = (
              await tx.engagement.create({
                data: {
                  tenantId,
                  personId: person.id,
                  employeeCode: r.employee_code,
                  ...engData,
                },
              })
            ).id;
          }
        } catch (e) {
          if ((e as { code?: string }).code === 'P2002') {
            throw new BadRequestException(
              `Line ${p.line}: work email already belongs to someone else`,
            );
          }
          throw e;
        }
        engagementByCode.set(key(r.employee_code), engagementId);
        if (r.type === 'intern') {
          const detail = {
            college: r.college ?? null,
            course: r.course ?? null,
            graduationYear: r.graduation_year ?? null,
          };
          await tx.internDetail.upsert({
            where: { engagementId },
            update: detail,
            create: { tenantId, engagementId, ...detail },
          });
        }
      }
      for (const p of planned) {
        if (!p.row.manager_code) continue;
        const managerId =
          engagementByCode.get(key(p.row.manager_code)) ??
          (
            await tx.engagement.findFirstOrThrow({
              where: { employeeCode: p.row.manager_code },
            })
          ).id;
        await tx.engagement.update({
          where: { id: engagementByCode.get(key(p.row.employee_code))! },
          data: { managerId },
        });
      }
    });
  }
}
