import { z } from 'zod';
import { uuid } from './common.js';

export const assignRoleBody = z.object({
  userId: uuid,
  roleKey: z.string().min(1).max(64),
  entityId: uuid.optional(),
});
export const roleResponse = z.object({
  key: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  mfaRequired: z.boolean(),
  permissions: z.array(z.string()),
});
export type Role = z.infer<typeof roleResponse>;
