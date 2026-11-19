import { z } from 'zod';
import { dateField, email, uuid } from './common.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();

export const personFields = z.object({
  firstName: text(100),
  lastName: text(100),
  workEmail: email.nullish(),
  personalEmail: email.nullish(),
  phone: optText(32),
});

export const engagementFields = z.object({
  entityId: uuid,
  type: z.enum(['EMPLOYEE', 'INTERN']),
  employeeCode: text(32),
  departmentId: uuid.nullish(),
  designationId: uuid.nullish(),
  locationId: uuid.nullish(),
  managerId: uuid.nullish(),
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
  personId: uuid.optional(),
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

export const peopleListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['EMPLOYEE', 'INTERN']).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
  departmentId: uuid.optional(),
  entityId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const named = z.object({ id: z.string(), name: z.string() });
export const engagementResponse = z.object({
  id: z.string(),
  personId: z.string(),
  entityId: z.string(),
  type: z.enum(['EMPLOYEE', 'INTERN']),
  status: z.enum(['ACTIVE', 'ENDED']),
  employeeCode: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  managerId: z.string().nullable(),
  person: z.object({
    id: z.string(),
    userId: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string(),
    workEmail: z.string().nullable(),
    personalEmail: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  department: named.nullable(),
  designation: named.nullable(),
  location: named.nullable(),
  intern: z
    .object({
      college: z.string().nullable(),
      course: z.string().nullable(),
      graduationYear: z.number().nullable(),
    })
    .nullable(),
  manager: z
    .object({ id: z.string(), person: z.object({ firstName: z.string(), lastName: z.string() }) })
    .nullable(),
});
export const peopleListResponse = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  items: z.array(engagementResponse),
});

export const importIssue = z.object({
  line: z.number(),
  field: z.string().optional(),
  message: z.string(),
});
export const importResult = z.object({
  dryRun: z.boolean(),
  totalRows: z.number(),
  valid: z.boolean(),
  errors: z.array(importIssue),
  willCreate: z.object({
    people: z.number(),
    departments: z.array(z.string()),
    designations: z.array(z.string()),
    locations: z.array(z.string()),
  }),
  willUpdate: z.object({ people: z.number() }),
  committed: z.boolean(),
});

export type CreatePersonBody = z.infer<typeof createPersonBody>;
export type UpdatePersonBody = z.infer<typeof updatePersonBody>;
export type PeopleListQuery = z.input<typeof peopleListQuery>;
export type Engagement = z.infer<typeof engagementResponse>;
export type PeopleListResponse = z.infer<typeof peopleListResponse>;
export type ImportResult = z.infer<typeof importResult>;
export type ImportIssue = z.infer<typeof importIssue>;
