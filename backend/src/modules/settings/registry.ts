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

const DOMAIN =
  /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function isTimeZone(v: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** `203.0.113.0/24`, `203.0.113.7` or an IPv6 address with an optional /bits. */
export function isCidr(v: string): boolean {
  const [addr, bits, extra] = v.split('/');
  if (extra !== undefined || !addr) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) {
    if (v4.slice(1).some((o) => Number(o) > 255)) return false;
    return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  }
  if (/^[0-9a-f:]+$/i.test(addr) && addr.includes(':'))
    return (
      bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= 128)
    );
  return false;
}

function def<T>(d: SettingDefinition<T>): SettingDefinition<T> {
  return d;
}

/** Every setting is declared once here. Add new ones as modules need them. */
export const SETTINGS = {
  /** A person's own light/dark choice. The company's default comes from its published brand. */
  'branding.defaultTheme': def({
    schema: z.enum(['dark', 'light', 'system']),
    default: 'dark',
    levels: ['user'],
    label: 'My colour theme',
    group: 'Branding',
    description: 'Your own choice of light or dark',
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
  'region.timeZone': def({
    schema: z.string().refine(isTimeZone, 'Not a known time zone'),
    default: 'Asia/Kolkata',
    levels: ['tenant', 'entity'],
    label: 'Time zone',
    group: 'Region',
    kind: 'timezone',
    description:
      'Dates and times are shown in this zone, and daily emails go out at 08:00 in it',
  }),
  'region.dateFormat': def({
    schema: z.enum(['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
    default: 'DD MMM YYYY',
    levels: ['tenant'],
    label: 'Date format',
    group: 'Region',
    description: 'For example 24 Nov 2026, 24/11/2026 or 2026-11-24',
  }),
  'region.numberGrouping': def({
    schema: z.enum(['indian', 'international']),
    default: 'indian',
    levels: ['tenant'],
    label: 'Number grouping',
    group: 'Region',
    description:
      'Indian grouping reads 12,34,567; international reads 1,234,567',
  }),
  'region.currency': def({
    schema: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']),
    default: 'INR',
    levels: ['tenant'],
    label: 'Currency',
    group: 'Region',
    description: 'The currency amounts are shown in',
  }),
  'region.fyStartMonth': def({
    schema: z.number().int().min(1).max(12),
    default: 4,
    levels: ['tenant', 'entity'],
    label: 'Financial year starts in month',
    group: 'Region',
    kind: 'number',
    description: '4 means April, the Indian financial year',
  }),
  'region.weekStart': def({
    schema: z.enum(['monday', 'sunday', 'saturday']),
    default: 'monday',
    levels: ['tenant'],
    label: 'Week starts on',
    group: 'Region',
    description: 'The first day of the week in calendars',
  }),
  'security.passwordRequireMix': def({
    schema: z.boolean(),
    default: false,
    levels: ['tenant'],
    label: 'Passwords need letters, digits and a symbol',
    group: 'Sign-in',
    description:
      'New passwords must mix letters, numbers and at least one symbol',
  }),
  'security.passwordExpiryDays': def({
    schema: z.number().int().min(0).max(730),
    default: 0,
    levels: ['tenant'],
    label: 'Passwords expire after (days)',
    group: 'Sign-in',
    kind: 'number',
    description:
      '0 means never. After this many days people must choose a new password with Forgot password',
  }),
  'security.passwordHistory': def({
    schema: z.number().int().min(0).max(10),
    default: 0,
    levels: ['tenant'],
    label: 'Remember this many old passwords',
    group: 'Sign-in',
    kind: 'number',
    description:
      'A new password cannot repeat one of the last few. 0 turns it off',
  }),
  'security.idleTimeoutMinutes': def({
    schema: z.number().int().min(0).max(480),
    default: 0,
    levels: ['tenant'],
    label: 'Sign out after inactivity (minutes)',
    group: 'Sign-in',
    kind: 'number',
    description:
      '0 means never. The web app warns one minute before signing the person out',
  }),
  'signin.allowedEmailDomains': def({
    schema: z.array(z.string().trim().toLowerCase().regex(DOMAIN)).max(50),
    default: [],
    levels: ['tenant'],
    label: 'Allowed email domains',
    group: 'Sign-in',
    kind: 'list',
    description:
      'When set, invites and email changes to any other domain are refused. For example company.com',
  }),
  'signin.adminIpAllowlist': def({
    schema: z
      .array(z.string().trim().refine(isCidr, 'Not an address range'))
      .max(50),
    default: [],
    levels: ['tenant'],
    label: 'Admin sign-in address ranges',
    group: 'Sign-in',
    kind: 'list',
    description:
      'When set, people whose role can change settings may only sign in from these addresses, for example 203.0.113.0/24. Platform support can still help through a support session',
  }),
  'notifications.reminderHours': def({
    schema: z.array(z.coerce.number().int().min(1).max(720)).max(5),
    default: [24, 72],
    levels: ['tenant'],
    label: 'Remind after (hours)',
    group: 'Notifications',
    kind: 'list',
    description:
      'Someone who has not acted on a waiting approval is reminded this many hours after it started waiting',
  }),
  'notifications.quietHours': def({
    schema: z.object({
      enabled: z.boolean(),
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    default: { enabled: false, start: '22:00', end: '07:00' },
    levels: ['tenant'],
    label: 'Quiet hours',
    group: 'Notifications',
    kind: 'json',
    description:
      'Emails that can wait are held until quiet hours end. Codes, password links and security emails are never held',
  }),
  'logs.sampleGetsPercent': def({
    schema: z.number().int().min(0).max(100),
    default: 10,
    levels: [],
    label: 'Share of successful reads to keep',
    group: 'Logs',
    kind: 'number',
    description:
      'Every change, every failure and every slow request is kept. Of the quick successful page loads, this percentage is kept too',
  }),
  'logs.retentionDays': def({
    schema: z.number().int().min(7).max(180),
    default: 30,
    levels: [],
    label: 'Keep logs for (days)',
    group: 'Logs',
    kind: 'number',
    description:
      'Request, error and sign-in logs older than this are deleted every night',
  }),
  'alerts.errorSpikeCount': def({
    schema: z.number().int().min(1).max(10000),
    default: 20,
    levels: [],
    label: 'Errors in 10 minutes that count as a spike',
    group: 'Logs',
    kind: 'number',
    description: 'Per company, and for the whole server',
  }),
  'alerts.jobFailureCount': def({
    schema: z.number().int().min(1).max(1000),
    default: 3,
    levels: [],
    label: 'Failed background jobs that raise an alert',
    group: 'Logs',
    kind: 'number',
    description: 'Failures within the last 30 minutes',
  }),
  'alerts.mailFailureCount': def({
    schema: z.number().int().min(1).max(1000),
    default: 5,
    levels: [],
    label: 'Failed emails in 10 minutes that raise an alert',
    group: 'Logs',
    kind: 'number',
    description: 'Per company, and for the whole server',
  }),
  'alerts.signinFailureCount': def({
    schema: z.number().int().min(5).max(10000),
    default: 50,
    levels: [],
    label: 'Failed sign-ins in 10 minutes that raise an alert',
    group: 'Logs',
    kind: 'number',
    description: 'Per company',
  }),
  'alerts.diskFreePercent': def({
    schema: z.number().int().min(1).max(90),
    default: 15,
    levels: [],
    label: 'Disk space left that raises an alert (%)',
    group: 'Logs',
    kind: 'number',
    description: 'Free space on the server disk',
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
