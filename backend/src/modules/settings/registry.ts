import { z } from 'zod';

export type SettingLevel = 'user' | 'entity' | 'tenant';

export interface SettingDefinition<T = unknown> {
  schema: z.ZodType<T>;
  default: T;
  /** When the built-in value depends on the product name (set by APP_NAME). */
  defaultFrom?: (brand: { appName: string }) => T;
  /** Levels at which the value may be overridden (platform default is always possible; empty means platform-only). */
  levels: SettingLevel[];
  description: string;
  /** Short name for settings screens. */
  label: string;
  group:
    | 'Security'
    | 'Technical'
    | 'Branding'
    | 'Platform'
    | 'Brand'
    | 'Email'
    | 'Sign-in'
    | 'Region'
    | 'Notifications'
    | 'Integrations'
    | 'Logs';
  /** Which control to draw. Left out, it is read from the schema (see shapeOf). */
  kind?: SettingKind;
  /** One line on what the setting does, shown under the control. */
  hint?: string;
  /** The default for the lock: false means tenants cannot change it unless the super admin allows it. */
  tenantEditable?: boolean;
  /** True for a value that must never be shown again after saving (a secret). */
  sensitive?: boolean;
  /**
   * `layered` follows user → entity → tenant → platform; `platform` is one platform-wide value
   * (see RuntimeConfigService for keys and addresses).
   */
  scope?: 'layered' | 'platform';
}

function def<T>(d: SettingDefinition<T>): SettingDefinition<T> {
  return d;
}

/** Every setting is declared once here. Add new ones as modules need them. */
export const SETTINGS = {
  'branding.accentColor': def({
    schema: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    default: '#2a9158',
    levels: ['tenant', 'entity'],
    label: 'Accent colour',
    group: 'Branding',
    description: 'Accent colour used across the tenant’s screens',
  }),
  'branding.defaultTheme': def({
    schema: z.enum(['dark', 'light', 'system']),
    default: 'dark',
    levels: ['tenant', 'user'],
    label: 'Default theme',
    group: 'Branding',
    description: 'Default colour theme',
  }),
  'branding.emailSenderName': def({
    schema: z.string().min(1).max(80),
    default: 'Flourishive',
    defaultFrom: (b) => b.appName,
    levels: ['tenant', 'entity'],
    label: 'Email sender name',
    group: 'Branding',
    description: 'Sender name on emails',
  }),
  'signing.allowWithoutDsc': def({
    schema: z.boolean(),
    default: false,
    levels: ['tenant'],
    label: 'Allow signing without a DSC token',
    group: 'Security',
    description:
      'Signatories may sign letters in the desktop or web app without the USB certificate token. The letter gets a visible stamp and the organisation seal, and is labelled "Signed electronically (no DSC)". Needs the signatory to confirm with their authenticator code.',
  }),
  'documents.holdOfferDownloads': def({
    schema: z.boolean(),
    default: true,
    levels: ['tenant'],
    label: 'Hold offer letter downloads',
    group: 'Security',
    description:
      'Candidates cannot download an offer letter until an admin releases it (stops offer shopping)',
  }),
  'security.passwordMinLength': def({
    schema: z.number().int().min(8).max(64),
    default: 12,
    levels: ['tenant'],
    label: 'Minimum password length',
    group: 'Security',
    description: 'Minimum password length',
  }),
  'security.otpExpiryMinutes': def({
    schema: z.number().int().min(3).max(30),
    default: 10,
    levels: ['tenant'],
    label: 'One-time code validity (minutes)',
    group: 'Security',
    description: 'How long an emailed one-time code stays valid (minutes)',
  }),
  'platform.superAdminMfa': def({
    schema: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
    default: 'REQUIRED',
    levels: [],
    label: 'Two-step for platform staff',
    group: 'Platform',
    description: 'Two-step policy for platform (super admin) staff',
  }),
  'platform.superAdminRecoveryEmail': def({
    schema: z.boolean(),
    default: true,
    levels: [],
    label: 'Email recovery for platform staff',
    group: 'Platform',
    description: 'Let platform staff recover access with an emailed code',
  }),
  'security.sessionDays': def({
    schema: z.number().int().min(1).max(30),
    default: 14,
    levels: ['tenant'],
    label: 'Stay signed in (days)',
    group: 'Security',
    description: 'How long a sign-in lasts without activity',
  }),
  'security.trustedDeviceDays': def({
    schema: z.number().int().min(0).max(90),
    default: 30,
    levels: ['tenant'],
    label: 'Remember a device after two-step (days)',
    group: 'Security',
    description:
      'After a successful two-step code a person may tick "Remember this device" and skip the code on it for this many days. 0 turns the option off',
  }),
  'security.adminSessionDays': def({
    schema: z.number().int().min(1).max(30),
    default: 14,
    levels: ['tenant'],
    label: 'Stay signed in, for admins (days)',
    group: 'Security',
    description:
      'How long a sign-in lasts for people whose role can manage something (instead of the length for everyone else)',
  }),
  'platform.trustedDeviceDays': def({
    schema: z.number().int().min(0).max(90),
    default: 30,
    levels: [],
    label: 'Remember a device, for platform staff (days)',
    group: 'Platform',
    description:
      'After a two-step code platform staff may skip it on that device for this many days. 0 turns the option off',
  }),
  'security.loginAttempts': def({
    schema: z.number().int().min(3).max(10),
    default: 5,
    levels: ['tenant'],
    label: 'Failed sign-ins before a temporary lock',
    group: 'Technical',
    description:
      'Wrong passwords allowed within 15 minutes before sign-in is locked',
  }),
  'files.maxUploadMb': def({
    schema: z.number().int().min(1).max(20),
    default: 20,
    levels: ['tenant'],
    label: 'Largest upload (MB)',
    group: 'Technical',
    description: 'Biggest file a person can upload',
  }),
} satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValueOf<K extends SettingKey> = z.infer<
  (typeof SETTINGS)[K]['schema']
>;
export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

export type SettingKind =
  | 'boolean'
  | 'number'
  | 'enum'
  | 'color'
  | 'font'
  | 'image'
  | 'text'
  | 'longtext'
  | 'email'
  | 'url'
  | 'secret'
  | 'list'
  | 'timezone'
  | 'json';
export interface SettingShape {
  kind: SettingKind;
  options?: string[];
  min?: number;
  max?: number;
}

/** What control a settings screen should draw, read from the setting's own schema. */
export function shapeOf(key: SettingKey): SettingShape {
  const declared = (SETTINGS[key] as SettingDefinition).kind;
  const schema = SETTINGS[key].schema as z.ZodType;
  if (declared && !(declared === 'enum' && schema instanceof z.ZodEnum))
    return { kind: declared };
  if (schema instanceof z.ZodBoolean) return { kind: 'boolean' };
  if (schema instanceof z.ZodNumber)
    return {
      kind: 'number',
      min: schema.minValue ?? undefined,
      max: schema.maxValue ?? undefined,
    };
  if (schema instanceof z.ZodEnum)
    return { kind: 'enum', options: [...schema.options].map(String) };
  return { kind: key.endsWith('Color') ? 'color' : 'text' };
}
