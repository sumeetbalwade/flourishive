import { z } from 'zod';

export const platformLoginBody = z.object({
  email: z.string().email().max(191),
  password: z.string().min(1).max(256),
});
export const platformMfaVerifyBody = z
  .object({
    mfaToken: z.string(),
    code: z.string().optional(),
    recoveryCode: z.string().optional(),
  })
  .refine((b) => b.code || b.recoveryCode, 'code or recoveryCode is required');
export const platformMfaSetupBody = z.object({ mfaToken: z.string() });
export const platformMfaConfirmBody = z.object({
  mfaToken: z.string(),
  code: z.string().regex(/^\d{6}$/),
});
export const platformPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(1).max(256),
});

export const createTenantBody = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Use 3-63 lowercase letters, digits or hyphens'),
  name: z.string().trim().min(1).max(191),
  companyName: z.string().trim().min(1).max(191),
  legalName: z.string().trim().min(1).max(191),
  adminEmail: z.string().trim().toLowerCase().email().max(191),
});
export const patchTenantBody = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export const inviteStaffBody = z.object({ email: z.string().trim().email().max(191) });
export const staffStatusBody = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });

const counts = z.object({
  users: z.number(),
  engagements: z.number(),
  entities: z.number().optional(),
});
export const tenantListItem = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  createdAt: z.string(),
  counts,
});
export const tenantDetail = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  createdAt: z.string(),
  entities: z.array(z.object({ id: z.string(), name: z.string(), legalName: z.string() })),
  counts,
  auditChain: z.object({ ok: z.boolean(), checked: z.number(), reason: z.string().optional() }),
  settingOverrides: z.record(z.string(), z.unknown()),
});
export const staffItem = z.object({
  id: z.string(),
  email: z.string(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']),
  mfaEnabledAt: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export const platformSettingItem = z.object({
  key: z.string(),
  description: z.string(),
  levels: z.array(z.string()),
  default: z.unknown(),
  platformValue: z.unknown(),
});
export const platformMe = z.object({ id: z.string(), email: z.string(), mfaEnabled: z.boolean() });
export const staffInviteResponse = z.object({
  id: z.string(),
  link: z.string(),
  emailed: z.boolean(),
});
export const createTenantResponse = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  adminEmail: z.string(),
});

export type CreateTenantBody = z.infer<typeof createTenantBody>;
export type TenantListItem = z.infer<typeof tenantListItem>;
export type TenantDetail = z.infer<typeof tenantDetail>;
export type StaffItem = z.infer<typeof staffItem>;
export type PlatformSettingItem = z.infer<typeof platformSettingItem>;
