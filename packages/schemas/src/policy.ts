import { z } from 'zod';

/** Two-step level for a role: OFF stops enforcement, OPTIONAL lets people enrol, REQUIRED forces it at sign-in. */
export const mfaLevel = z.enum(['OFF', 'OPTIONAL', 'REQUIRED']);
export type MfaLevel = z.infer<typeof mfaLevel>;

const flags = {
  mfaLevel,
  recoveryEmail: z.boolean(),
  recoveryCodes: z.boolean(),
};

/** What a tenant sees for each of its roles. */
export const tenantRolePolicy = z.object({
  roleKey: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  mfaFloor: mfaLevel,
  ...flags,
});
export type TenantRolePolicy = z.infer<typeof tenantRolePolicy>;

/** What the super admin sees for each system role. */
export const platformRolePolicy = z.object({
  roleKey: z.string(),
  name: z.string(),
  mfaFloor: mfaLevel,
  ...flags,
});
export type PlatformRolePolicy = z.infer<typeof platformRolePolicy>;

export const tenantPolicyPatch = z
  .object({
    mfaLevel: mfaLevel.optional(),
    recoveryEmail: z.boolean().optional(),
    recoveryCodes: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const platformPolicyPatch = z
  .object({
    mfaLevel: mfaLevel.optional(),
    mfaFloor: mfaLevel.optional(),
    recoveryEmail: z.boolean().optional(),
    recoveryCodes: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const createRoleBody = z.object({
  name: z.string().trim().min(2).max(60),
  mfaLevel: mfaLevel.default('OPTIONAL'),
});
export type PlatformPolicyPatch = z.infer<typeof platformPolicyPatch>;
export type TenantPolicyPatch = z.infer<typeof tenantPolicyPatch>;
