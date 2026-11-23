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
    emailCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    remember: z.boolean().optional(),
  })
  .refine((b) => b.code || b.recoveryCode || b.emailCode, 'a code is required');
export const platformMfaSetupBody = z.object({ mfaToken: z.string() });
export const platformMfaConfirmBody = z.object({
  mfaToken: z.string(),
  code: z.string().regex(/^\d{6}$/),
});
export const platformRecoveryVerifyBody = z.object({
  mfaToken: z.string(),
  code: z.string().regex(/^\d{6}$/),
});
export const platformPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(1).max(256),
});

/** Names the platform keeps for itself, because each company gets <slug>.flourishive.in. */
export const RESERVED_SLUGS = [
  'app',
  'admin',
  'api',
  'verify',
  'www',
  'mail',
  'smtp',
  'support',
  'status',
  'help',
  'docs',
  'blog',
  'cdn',
  'static',
  'assets',
  'login',
  'signin',
  'auth',
  'billing',
  'flourishive',
  'flourisense-admin',
  'staging',
  'dev',
  'test',
  'demo',
] as const;
export const companySlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'Use 3-63 lowercase letters, digits or hyphens')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'That name is reserved');

export const createTenantBody = z.object({
  slug: companySlug,
  name: z.string().trim().min(1).max(191),
  companyName: z.string().trim().min(1).max(191),
  legalName: z.string().trim().min(1).max(191),
  adminEmail: z.string().trim().toLowerCase().email().max(191),
});
export const patchTenantBody = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export const inviteStaffBody = z.object({
  email: z.string().trim().email().max(191),
  roleId: z.string().min(1),
});
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
  role: z.object({ id: z.string(), key: z.string(), name: z.string() }),
});
export const platformSettingItem = z.object({
  key: z.string(),
  description: z.string(),
  label: z.string(),
  group: z.string(),
  kind: z.enum([
    'boolean',
    'number',
    'enum',
    'color',
    'font',
    'image',
    'text',
    'longtext',
    'email',
    'url',
    'secret',
    'list',
    'timezone',
    'json',
  ]),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  levels: z.array(z.string()),
  default: z.unknown(),
  platformValue: z.unknown(),
  locked: z.boolean(),
});
export const platformSettingBody = z
  .object({ value: z.unknown().optional(), locked: z.boolean().optional() })
  .refine((b) => b.value !== undefined || b.locked !== undefined, 'value or locked is required');
export const platformMe = z.object({
  id: z.string(),
  email: z.string(),
  mfaEnabled: z.boolean(),
  role: z.object({ id: z.string(), key: z.string(), name: z.string() }).nullable(),
  /** Platform permission codes the signed-in staff member holds; the console hides what they cannot use. */
  permissions: z.array(z.string()),
});
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

/** Confirm it is you before a sensitive action: an authenticator code, or the password when there is no two-step. */
export const stepUpBody = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    password: z.string().min(1).max(256).optional(),
  })
  .refine((b) => b.code || b.password, 'code or password is required');

export const runtimeConfigEntry = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  hint: z.string(),
  kind: z.enum(['text', 'number', 'boolean', 'url', 'secret']),
  restartRequired: z.boolean(),
  source: z.enum(['console', 'environment', 'default', 'unset']),
  /** Never present for a secret. */
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  isSet: z.boolean(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().nullable().optional(),
});
export const runtimeConfigBody = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export const configTestResult = z.object({ ok: z.boolean(), message: z.string() });
export type RuntimeConfigEntry = z.infer<typeof runtimeConfigEntry>;
export type ConfigTestResult = z.infer<typeof configTestResult>;

export const systemInfo = z.object({
  /** True only where something restarts the API after it exits (the production service). */
  canRestart: z.boolean(),
  version: z.string(),
  startedAt: z.string(),
  uptimeSeconds: z.number(),
});
export type SystemInfo = z.infer<typeof systemInfo>;

export const platformRoleView = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isPreset: z.boolean(),
  permissions: z.array(z.string()),
  members: z.number(),
});
export const platformPermissionInfo = z.object({
  code: z.string(),
  area: z.string(),
  label: z.string(),
  hint: z.string(),
});
export const platformRolesResponse = z.object({
  roles: z.array(platformRoleView),
  permissions: z.array(platformPermissionInfo),
});
export const createPlatformRoleBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(255).optional(),
  permissions: z.array(z.string()).max(60),
});
export const updatePlatformRoleBody = createPlatformRoleBody.partial();
export const platformAssignRoleBody = z.object({ roleId: z.string().min(1) });
export type PlatformRoleView = z.infer<typeof platformRoleView>;
export type PlatformPermissionInfo = z.infer<typeof platformPermissionInfo>;
export type PlatformRolesResponse = z.infer<typeof platformRolesResponse>;

export const startSupportBody = z.object({
  reason: z.string().trim().min(5, 'Say why you are opening this company').max(500),
  mode: z.enum(['READ', 'WRITE']).default('READ'),
  minutes: z.number().int().min(5).max(240).default(60),
});
export const supportSessionStarted = z.object({
  sessionId: z.string(),
  accessToken: z.string(),
  expiresAt: z.string(),
  mode: z.enum(['READ', 'WRITE']),
  /** Where to open the company's web app (the token travels in the URL fragment). */
  url: z.string(),
});
export const supportSessionView = z.object({
  id: z.string(),
  staff: z.string(),
  reason: z.string(),
  mode: z.enum(['READ', 'WRITE']),
  startedAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
  active: z.boolean(),
});
export type StartSupportBody = z.infer<typeof startSupportBody>;
export type SupportSessionStarted = z.infer<typeof supportSessionStarted>;
export type SupportSessionView = z.infer<typeof supportSessionView>;

/** What an admin can do to a sign-in account (D-63). Each needs a reason and a fresh confirmation. */
export const ACCOUNT_ACTIONS = [
  'reset-password',
  'reset-mfa',
  'unlock',
  'sign-out-everywhere',
  'suspend',
  'reactivate',
  'resend-invite',
] as const;
export const accountAction = z.enum(ACCOUNT_ACTIONS);
export type AccountAction = z.infer<typeof accountAction>;
export const accountActionBody = z.object({
  reason: z.string().trim().min(5, 'Say why (at least a few words)').max(300),
});
export const accountView = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']),
  lastLoginAt: z.string().nullable(),
  mfaEnabled: z.boolean(),
  /** The role policy requires two-step for this person. */
  mfaRequired: z.boolean(),
  trustedDevices: z.number(),
  passkeys: z.number().default(0),
  roles: z.array(z.string()),
  /** Which actions the signed-in admin may take on this account right now (rules and state applied). */
  allowed: z.array(accountAction),
});
export type AccountView = z.infer<typeof accountView>;
export const accountActionResult = z.object({
  ok: z.literal(true),
  /** A link to hand over when the email could not be sent (platform staff only). */
  link: z.string().optional(),
  emailed: z.boolean().optional(),
});

export const accountListItem = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']),
  lastLoginAt: z.string().nullable(),
  mfaEnabled: z.boolean(),
  roles: z.array(z.string()),
});
export type AccountListItem = z.infer<typeof accountListItem>;
