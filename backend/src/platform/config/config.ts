import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Every environment variable the API reads, validated once at startup. */
const base = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_VERSION: z.string().default('dev'),
  // Product name and domain. Change these (and the frontends' brand.json) to rename the product
  // or move it to another website; nothing else in the code carries the name or the domain.
  APP_NAME: z.string().trim().min(1).default('Flourishive'),
  APP_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'a domain such as example.com')
    .optional(),
  // Each of these is built from APP_DOMAIN when left out.
  CORS_ORIGINS: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  MAIL_FROM: z.string().optional(),

  // Outside public_html in production.
  STORAGE_DIR: z.string().default('./storage'),

  // Where file bytes live. `r2` is a private Cloudflare R2 bucket (D-72); `local` is STORAGE_DIR.
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // While moving to R2, a missing object is read from local disk instead (D-74).
  STORAGE_LOCAL_FALLBACK: bool.default(true),

  // 32 bytes as 64 hex characters. Generate with `openssl rand -hex 32`.
  FIELD_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters'),
  HMAC_SECRET: z.string().min(32),

  // Signs access and MFA-challenge JWTs.
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  COOKIE_SECURE: bool.default(false),
  // Google sign-in is off until a client id is configured.
  GOOGLE_CLIENT_ID: z.string().optional(),
  // Where a company's people sign in. {slug} becomes the company's short name.
  TENANT_URL_TEMPLATE: z.string().optional(),
  // Used to build password-reset links.
  WEB_URL: z.string().optional(),
  ADMIN_URL: z.string().optional(),
  // Where a document's QR code points (the public verify site).
  VERIFY_URL: z.string().optional(),
  // The public address of this API (put in pairing links so the desktop app knows where to connect).
  API_URL: z.string().optional(),
  // The organisation seal (D-41): PEM key and certificate, base64 encoded. Development makes a temporary one.
  SEAL_KEY_BASE64: z.string().optional(),
  SEAL_CERT_BASE64: z.string().optional(),
  // RFC 3161 time-stamp server for seals; leave out to seal without a time-stamp.
  SEAL_TSA_URL: z.string().url().optional(),
  // DSC validation (D-48). Folders of PEM certificates the server trusts: licensed CA roots
  // (Controller of Certifying Authorities) and time-stamp authorities.
  // The time-stamp server the desktop app uses when signing; the server must trust its authority.
  DSC_TSA_URL: z.string().url().default('http://timestamp.digicert.com'),
  TRUSTED_ROOTS_DIR: z.string().optional(),
  TRUSTED_TSA_DIR: z.string().optional(),
  // Company addresses (<slug>.<APP_DOMAIN>) are created in Cloudflare DNS when a company is added.
  // Leave these out (development) and no DNS is touched. Token needs "DNS: Edit" on this one zone.
  CLOUDFLARE_API_TOKEN: z.string().min(20).optional(),
  CLOUDFLARE_ZONE_ID: z
    .string()
    .regex(/^[0-9a-f]{32}$/i)
    .optional(),
  // The server's public IPv4 address that company names point at.
  DNS_TARGET_IP: z.ipv4().optional(),
  // true = traffic goes through Cloudflare's proxy (orange cloud).
  DNS_PROXIED: bool.default(false),
  // Development only (D-38): accept a signer certificate outside its dates. Ignored in production.
  ALLOW_EXPIRED_SIGNER_CERT: bool.default(false),
});

/**
 * Fills in what was left out. With APP_DOMAIN set, addresses follow the usual layout
 * (app., admin., verify., and one subdomain per company); without it they point at localhost.
 */
export function withDerivedDefaults<T extends z.infer<typeof base>>(c: T) {
  const d = c.APP_DOMAIN;
  return {
    ...c,
    TENANT_URL_TEMPLATE:
      c.TENANT_URL_TEMPLATE ??
      (d ? `https://{slug}.${d}` : 'http://{slug}.localhost:5173'),
    WEB_URL: c.WEB_URL ?? (d ? `https://app.${d}` : 'http://localhost:5173'),
    ADMIN_URL:
      c.ADMIN_URL ?? (d ? `https://admin.${d}` : 'http://localhost:5174'),
    API_URL: c.API_URL ?? (d ? `https://api.${d}` : 'http://localhost:3000'),
    VERIFY_URL:
      c.VERIFY_URL ?? (d ? `https://verify.${d}` : 'http://localhost:5175'),
    MAIL_FROM: c.MAIL_FROM ?? `${c.APP_NAME} <no-reply@${d ?? 'localhost'}>`,
    CORS_ORIGINS: corsOrigins(c.CORS_ORIGINS, d),
  };
}

export const envSchema = base.transform(withDerivedDefaults);
export type AppConfig = z.output<typeof envSchema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Allowed browser origins: the explicit list, else the usual layout under APP_DOMAIN, else localhost. */
export function corsOrigins(explicit?: string, domain?: string): string {
  if (explicit !== undefined) return explicit;
  const d = domain?.trim().toLowerCase();
  return d
    ? [
        `https://app.${d}`,
        `https://admin.${d}`,
        `https://verify.${d}`,
        `https://*.${d}`,
      ].join(',')
    : 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://*.localhost:5173';
}
