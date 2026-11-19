import { z } from 'zod';
import { uuid } from './common.js';
import { mfaLevel } from './policy.js';

export const assignRoleBody = z.object({
  userId: uuid,
  roleKey: z.string().min(1).max(64),
  entityId: uuid.optional(),
});
export const roleResponse = z.object({
  key: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  mfaLevel: mfaLevel,
  recoveryEmail: z.boolean(),
  recoveryCodes: z.boolean(),
  permissions: z.array(z.string()),
});
export type Role = z.infer<typeof roleResponse>;
export const userRoleItem = z.object({
  roleKey: z.string(),
  name: z.string(),
  entityId: z.string().nullable(),
});
export type UserRoleItem = z.infer<typeof userRoleItem>;
