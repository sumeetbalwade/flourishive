import { z } from 'zod';

export const settingValueBody = z.object({ value: z.unknown() });

export const settingsResponse = z.object({
  values: z.record(z.string(), z.unknown()),
  locked: z.array(z.string()).default([]),
  definitions: z.record(
    z.string(),
    z.object({ levels: z.array(z.enum(['user', 'entity', 'tenant'])), description: z.string() }),
  ),
});
export type SettingsResponse = z.infer<typeof settingsResponse>;
