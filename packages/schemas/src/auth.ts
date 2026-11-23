import { z } from 'zod';
import { mfaLevel } from './policy.js';
import { email } from './common.js';

const tenant = z.string().min(1).max(63);
const code = z.string().regex(/^\d{6}$/);

export const loginBody = z.object({
  tenant,
  email: z.string().email().max(191),
  password: z.string().min(1).max(256),
});
export const googleBody = z.object({ tenant, idToken: z.string().min(1) });
export const mfaVerifyBody = z
  .object({
    mfaToken: z.string(),
    code: z.string().optional(),
    recoveryCode: z.string().optional(),
    /** A code emailed to the person (where the role's policy allows it). */
    emailCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    /** Skip the code on this browser for the company's remember-device period. */
    remember: z.boolean().optional(),
  })
  .refine((b) => b.code || b.recoveryCode || b.emailCode, 'a code is required');
export const mfaSetupBody = z.object({ mfaToken: z.string().optional() });
export const mfaConfirmBody = z.object({ mfaToken: z.string().optional(), code });
export const refreshBody = z.object({ refreshToken: z.string().optional() }).default({});
export const forgotBody = z.object({ tenant, email: z.string().email().max(191) });
export const recoveryVerifyBody = z.object({ tenant, email: z.string().email().max(191), code });
export const mfaRecoveryStartBody = z.object({ mfaToken: z.string() });
export const mfaRecoveryVerifyBody = z.object({ mfaToken: z.string(), code });
export const resetBody = z.object({
  token: z.string().min(1),
  password: z.string().min(1).max(256),
});

export const tokensResponse = z.object({
  status: z.literal('ok'),
  accessToken: z.string(),
  expiresIn: z.number(),
  /** Only returned to native clients (X-Client: native); browsers get an httpOnly cookie. */
  refreshToken: z.string().optional(),
});
export const loginResponse = z.discriminatedUnion('status', [
  tokensResponse,
  z.object({
    status: z.literal('mfa_required'),
    mfaToken: z.string(),
    /** Which second steps this person has. Older servers omit it: then it is the authenticator code. */
    methods: z.object({ code: z.boolean(), passkey: z.boolean() }).optional(),
  }),
  z.object({ status: z.literal('mfa_setup_required'), mfaToken: z.string() }),
]);
export const mfaSetupResponse = z.object({ secret: z.string(), otpauthUri: z.string() });
export const mfaConfirmResponse = z.object({
  recoveryCodes: z.array(z.string()),
  /** Present when enrolment was forced at sign-in and completes the login. */
  status: z.literal('ok').optional(),
  accessToken: z.string().optional(),
  expiresIn: z.number().optional(),
  refreshToken: z.string().optional(),
});
export const meResponse = z.object({
  id: z.string(),
  tenantId: z.string(),
  email: email.or(z.string()),
  mfaEnabled: z.boolean(),
  mfaRequired: z.boolean(),
  mfaLevel: mfaLevel,
  permissions: z.array(z.string()),
  /** Present when the person is platform staff in a support session rather than a company user. */
  support: z
    .object({
      sessionId: z.string(),
      mode: z.enum(['READ', 'WRITE']),
      reason: z.string(),
      expiresAt: z.string(),
    })
    .optional(),
});

export type LoginBody = z.infer<typeof loginBody>;
export type LoginResponse = z.infer<typeof loginResponse>;
export type TokensResponse = z.infer<typeof tokensResponse>;
export type MeResponse = z.infer<typeof meResponse>;
export type MfaSetupResponse = z.infer<typeof mfaSetupResponse>;
export type MfaConfirmResponse = z.infer<typeof mfaConfirmResponse>;

/** What the sign-in page may show before anyone is signed in. */
export const companyPublic = z.object({
  slug: z.string(),
  name: z.string(),
  accentColor: z.string(),
});
export type CompanyPublic = z.infer<typeof companyPublic>;
export const findCompanyBody = z.object({ email: z.string().email().max(191) });

export const mfaEmailCodeBody = z.object({ mfaToken: z.string() });
export const mfaDisableBody = z.object({ password: z.string().min(1).max(256) });
export const trustedDeviceView = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
});
/** A browser's WebAuthn answer. The server hands it to the library, which does the real checking. */
const webauthnJson = z
  .object({
    id: z.string().min(1).max(1024),
    response: z.object({ clientDataJSON: z.string().min(1).max(8192) }).passthrough(),
  })
  .passthrough();
export const passkeyRegisterBody = z.object({
  response: webauthnJson,
  label: z.string().trim().max(120).optional(),
});
export const passkeyLoginOptionsBody = z.object({ tenant: z.string().min(1).max(63) });
export const passkeyLoginBody = z.object({
  tenant: z.string().min(1).max(63),
  response: webauthnJson,
});
export const mfaPasskeyBody = z.object({ mfaToken: z.string(), response: webauthnJson });
export const platformPasskeyLoginBody = z.object({ response: webauthnJson });
export const passkeyView = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
});
export type PasskeyView = z.infer<typeof passkeyView>;

/** What "My security" shows and may offer. */
export const securityInfo = z.object({
  mfaEnabled: z.boolean(),
  /** The role policy allows turning two-step off (it is not REQUIRED). */
  canDisableMfa: z.boolean(),
  emailFallback: z.boolean(),
  trustedDeviceDays: z.number(),
  devices: z.array(trustedDeviceView),
  passkeys: z.array(passkeyView).default([]),
});
export type SecurityInfo = z.infer<typeof securityInfo>;
export type TrustedDeviceView = z.infer<typeof trustedDeviceView>;
