import { z } from 'zod';

export type RuntimeGroup =
  | 'Email'
  | 'Google sign-in'
  | 'Cloudflare'
  | 'Time-stamping'
  | 'Error tracking'
  | 'File storage'
  | 'Addresses';

export interface RuntimeKeyDefinition {
  label: string;
  group: RuntimeGroup;
  hint: string;
  kind: 'text' | 'number' | 'boolean' | 'url' | 'secret';
  schema: z.ZodType<string | number | boolean>;
  /** A change only takes effect after the API restarts (the value is read once at startup). */
  restartRequired?: boolean;
}

const text = z.string().trim().min(1).max(500);
const url = z.string().trim().url().max(500);

/**
 * Settings the super admin can change from the console without editing `api.env`.
 * The key is the environment variable name, which stays the fallback (console, then env, then default).
 */
export const RUNTIME_KEYS = {
  SMTP_HOST: {
    label: 'Mail server',
    group: 'Email',
    kind: 'text',
    schema: text,
    hint: 'Host name of the SMTP server that sends every email',
  },
  SMTP_PORT: {
    label: 'Mail server port',
    group: 'Email',
    kind: 'number',
    schema: z.number().int().min(1).max(65535),
    hint: 'Usually 587 (STARTTLS) or 465 (secure)',
  },
  SMTP_SECURE: {
    label: 'Use a secure connection',
    group: 'Email',
    kind: 'boolean',
    schema: z.boolean(),
    hint: 'On for port 465; off for 587 or a local test server',
  },
  SMTP_USER: {
    label: 'Mail user name',
    group: 'Email',
    kind: 'text',
    schema: text,
    hint: 'Leave empty if the server needs no sign-in',
  },
  SMTP_PASS: {
    label: 'Mail password',
    group: 'Email',
    kind: 'secret',
    schema: z.string().min(1).max(500),
    hint: 'Stored encrypted; never shown again after saving',
  },
  MAIL_FROM: {
    label: 'From address',
    group: 'Email',
    kind: 'text',
    schema: text,
    hint: 'For example: Flourishive <no-reply@flourishive.in>',
  },
  GOOGLE_CLIENT_ID: {
    label: 'Google client ID',
    group: 'Google sign-in',
    kind: 'text',
    schema: z
      .string()
      .trim()
      .regex(
        /^[\w-]+\.apps\.googleusercontent\.com$/,
        'Not a Google client ID',
      ),
    hint: 'From Google Cloud Console. Leave empty to turn Google sign-in off',
  },
  CLOUDFLARE_API_TOKEN: {
    label: 'Cloudflare API token',
    group: 'Cloudflare',
    kind: 'secret',
    schema: z.string().min(20).max(500),
    hint: 'Needs "DNS: Edit" on the one zone. Used to create company addresses',
  },
  CLOUDFLARE_ZONE_ID: {
    label: 'Cloudflare zone ID',
    group: 'Cloudflare',
    kind: 'text',
    schema: z.string().regex(/^[0-9a-f]{32}$/i, 'Expected 32 hex characters'),
    hint: 'On the zone’s Overview page in Cloudflare',
  },
  DNS_TARGET_IP: {
    label: 'Server address (IPv4)',
    group: 'Cloudflare',
    kind: 'text',
    schema: z.ipv4(),
    hint: 'The public IP that company addresses point at',
  },
  DNS_PROXIED: {
    label: 'Use the Cloudflare proxy',
    group: 'Cloudflare',
    kind: 'boolean',
    schema: z.boolean(),
    hint: 'Orange cloud: traffic goes through Cloudflare',
  },
  SEAL_TSA_URL: {
    label: 'Seal time-stamp server',
    group: 'Time-stamping',
    kind: 'url',
    schema: url,
    hint: 'RFC 3161 server used for the organisation seal. Empty seals without a time-stamp',
  },
  DSC_TSA_URL: {
    label: 'Signing time-stamp server',
    group: 'Time-stamping',
    kind: 'url',
    schema: url,
    hint: 'RFC 3161 server the desktop app uses when signing with a DSC',
  },
  ERROR_TRACKING_DSN: {
    label: 'Error tracking address (DSN)',
    group: 'Error tracking',
    kind: 'secret',
    schema: url,
    hint: 'From a Sentry-compatible service. Empty turns forwarding off',
  },
  R2_ACCOUNT_ID: {
    label: 'R2 account ID',
    group: 'File storage',
    kind: 'text',
    schema: text,
    hint: 'Cloudflare account that owns the bucket',
    restartRequired: true,
  },
  R2_ACCESS_KEY_ID: {
    label: 'R2 access key ID',
    group: 'File storage',
    kind: 'secret',
    schema: z.string().min(1).max(500),
    hint: 'An API token limited to this one bucket',
    restartRequired: true,
  },
  R2_SECRET_ACCESS_KEY: {
    label: 'R2 secret access key',
    group: 'File storage',
    kind: 'secret',
    schema: z.string().min(1).max(500),
    hint: 'Shown by Cloudflare once; paste it here',
    restartRequired: true,
  },
  R2_BUCKET: {
    label: 'R2 bucket name',
    group: 'File storage',
    kind: 'text',
    schema: text,
    hint: 'A private bucket',
    restartRequired: true,
  },
  TENANT_URL_TEMPLATE: {
    label: 'Company address pattern',
    group: 'Addresses',
    kind: 'text',
    schema: z
      .string()
      .trim()
      .regex(/\{slug\}/, 'Must contain {slug}'),
    hint: 'Where a company signs in, for example https://{slug}.flourishive.in',
  },
  WEB_URL: {
    label: 'Web app address',
    group: 'Addresses',
    kind: 'url',
    schema: url,
    hint: 'Used in password-reset links',
  },
  ADMIN_URL: {
    label: 'Admin console address',
    group: 'Addresses',
    kind: 'url',
    schema: url,
    hint: 'Used in staff invitation links',
  },
  VERIFY_URL: {
    label: 'Verify site address',
    group: 'Addresses',
    kind: 'url',
    schema: url,
    hint: 'Where a document’s QR code and acceptance links point',
  },
  API_URL: {
    label: 'API address',
    group: 'Addresses',
    kind: 'url',
    schema: url,
    hint: 'Put in pairing links so the desktop app finds the server',
  },
} satisfies Record<string, RuntimeKeyDefinition>;

export type RuntimeKey = keyof typeof RUNTIME_KEYS;
export const isRuntimeKey = (k: string): k is RuntimeKey => k in RUNTIME_KEYS;
export const RUNTIME_GROUPS = [
  ...new Set(Object.values(RUNTIME_KEYS).map((d) => d.group)),
] as RuntimeGroup[];
