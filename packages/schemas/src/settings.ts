import { z } from 'zod';

export const settingValueBody = z.object({ value: z.unknown() });

export const settingsResponse = z.object({
  values: z.record(z.string(), z.unknown()),
  locked: z.array(z.string()).default([]),
  /** Keys this company has set itself. */
  overridden: z.array(z.string()).default([]),
  definitions: z.record(
    z.string(),
    z.object({
      levels: z.array(z.enum(['user', 'entity', 'tenant'])),
      description: z.string(),
      label: z.string(),
      group: z.string(),
      kind: z.enum(['boolean', 'number', 'enum', 'color', 'text']),
      options: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    }),
  ),
});
export type SettingsResponse = z.infer<typeof settingsResponse>;
