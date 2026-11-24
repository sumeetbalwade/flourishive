import { z } from 'zod';

/** Custom fields on people and engagements (D-29). */

export const customFieldEntity = z.enum(['PERSON', 'ENGAGEMENT']);
export type CustomFieldEntity = z.infer<typeof customFieldEntity>;

export const customFieldType = z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'FILE']);
export type CustomFieldType = z.infer<typeof customFieldType>;

export const CUSTOM_FIELD_TYPES: { key: CustomFieldType; label: string }[] = [
  { key: 'TEXT', label: 'Text' },
  { key: 'NUMBER', label: 'Number' },
  { key: 'DATE', label: 'Date' },
  { key: 'SELECT', label: 'Choice from a list' },
  { key: 'FILE', label: 'File' },
];

const roleKeys = z.array(z.string().min(1).max(40)).max(30).nullable();

export const customFieldBody = z
  .object({
    entityType: customFieldEntity,
    label: z.string().trim().min(1).max(80),
    helpText: z.string().trim().max(200).default(''),
    type: customFieldType,
    options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    required: z.boolean().default(false),
    visibleToRoles: roleKeys.default(null),
    editableByRoles: roleKeys.default(null),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .refine((b) => b.type !== 'SELECT' || new Set(b.options).size >= 1, {
    message: 'Add at least one choice',
    path: ['options'],
  });
export type CustomFieldBody = z.infer<typeof customFieldBody>;

export const customFieldView = z.object({
  id: z.string(),
  entityType: customFieldEntity,
  key: z.string(),
  label: z.string(),
  helpText: z.string(),
  type: customFieldType,
  options: z.array(z.string()),
  required: z.boolean(),
  visibleToRoles: z.array(z.string()).nullable(),
  editableByRoles: z.array(z.string()).nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  /** Whether the caller may change this field's value. */
  canEdit: z.boolean(),
});
export type CustomFieldView = z.infer<typeof customFieldView>;

/** A value is text, a number, a date (YYYY-MM-DD), a chosen option or a file id. */
export const customFieldValue = z.union([z.string().max(1000), z.number()]).nullable();

export const customFieldValuesBody = z.object({
  values: z.record(z.string().min(1).max(40), customFieldValue),
});
export type CustomFieldValuesBody = z.infer<typeof customFieldValuesBody>;

export const customFieldValuesView = z.array(
  z.object({
    field: customFieldView,
    value: customFieldValue,
  }),
);
export type CustomFieldValuesView = z.infer<typeof customFieldValuesView>;
