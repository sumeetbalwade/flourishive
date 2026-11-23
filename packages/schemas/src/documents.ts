import { z } from 'zod';
import { uuid } from './common.js';

export const LETTER_TYPES = ['OFFER', 'EXPERIENCE', 'REFERENCE', 'CERTIFICATE'] as const;
export type LetterType = (typeof LETTER_TYPES)[number];
export const letterType = z.enum(LETTER_TYPES);
export const orientation = z.enum(['PORTRAIT', 'LANDSCAPE']);

export const fieldDef = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/, 'Letters and digits only'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'longtext', 'date', 'number', 'amount']),
  required: z.boolean().default(true),
});
export type FieldDef = z.infer<typeof fieldDef>;

export const letterheadQuery = z.object({
  entityId: uuid,
  name: z.string().trim().min(1).max(100),
  orientation: orientation.default('PORTRAIT'),
  marginTop: z.coerce.number().int().min(0).max(400).optional(),
  marginBottom: z.coerce.number().int().min(0).max(400).optional(),
  marginLeft: z.coerce.number().int().min(0).max(300).optional(),
  marginRight: z.coerce.number().int().min(0).max(300).optional(),
  stampLeft: z.coerce.number().int().min(0).max(800).optional(),
  stampBottom: z.coerce.number().int().min(0).max(400).optional(),
});

/** Reference format tokens: {YYYY}, {YY} and {SEQ:n} (n digits, zero padded). */
export const referenceFormat = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .refine(
    (f) => /\{SEQ:[1-8]\}/.test(f),
    'The format must contain {SEQ:4} (or another digit count)',
  )
  .refine(
    (f) => !/\{(?!YYYY\}|YY\}|SEQ:[1-8]\})/.test(f),
    'Only {YYYY}, {YY} and {SEQ:n} are allowed between braces',
  );

export const numberingBody = z.object({
  entityId: uuid,
  letterType,
  format: referenceFormat,
  startAt: z.number().int().min(1).max(99999999).default(1),
});

export const templateBody = z.object({
  name: z.string().trim().min(1).max(120),
  letterType,
  layoutKey: z.string().min(1).max(60),
  content: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(fieldDef).max(40).optional(),
});
export const templateVersionBody = z.object({
  content: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(fieldDef).max(40).optional(),
});

export const generateBody = z.object({
  templateId: uuid,
  entityId: uuid,
  personId: uuid.optional(),
  engagementId: uuid.optional(),
  /** Values for the template's fields; dates as YYYY-MM-DD or DD/MM/YYYY. */
  fields: z.record(z.string(), z.string().max(5000)).default({}),
});
export type GenerateBody = z.infer<typeof generateBody>;

export const BULK_MAX_ROWS = 200;
export const bulkBody = z.object({
  templateId: uuid,
  entityId: uuid,
  /** Values every row shares (dates, signatory); a row's own value wins. */
  shared: z.record(z.string(), z.string().max(5000)).default({}),
  rows: z
    .array(
      z.object({
        personId: uuid.optional(),
        engagementId: uuid.optional(),
        fields: z.record(z.string(), z.string().max(5000)).default({}),
      }),
    )
    .min(1)
    .max(BULK_MAX_ROWS),
});
export type BulkBody = z.infer<typeof bulkBody>;

export const actionBody = z.object({
  action: z.string().min(1).max(60),
  comment: z.string().trim().max(1000).optional(),
});
export const reviseBody = z.object({
  fields: z.record(z.string(), z.string().max(5000)),
});

export const documentItem = z.object({
  id: z.string(),
  reference: z.string(),
  letterType: z.string(),
  status: z.string(),
  entityId: z.string(),
  personId: z.string().nullable(),
  sha256: z.string(),
  pageCount: z.number(),
  createdAt: z.string(),
});
export type DocumentItem = z.infer<typeof documentItem>;

/** Public verify page: what anyone may learn about an issued document (no personal data). */
export const verifyResult = z.object({
  result: z.enum(['valid', 'pending', 'revoked', 'superseded']),
  reference: z.string(),
  letterType: z.string(),
  issuedBy: z.string(),
  issuedOn: z.string(),
  stage: z.string(),
  acceptance: z.object({ method: z.string(), at: z.string(), sealed: z.boolean() }).nullable(),
  /** The authorised signatory's digital signature, once the certificate signature is in. */
  signature: z
    .object({
      /** `electronic`: signed without a certificate token (visible stamp and organisation seal). */
      kind: z.enum(['dsc', 'electronic']).default('dsc'),
      signer: z.string(),
      organisation: z.string().nullable(),
      issuer: z.string(),
      at: z.string(),
    })
    .nullable(),
  /** Signed during development with the relaxed certificate check; never genuine. */
  test: z.boolean(),
  /** Only on a look-up by reference: lets the page offer the file comparison. */
  token: z.string().optional(),
});
export type VerifyResult = z.infer<typeof verifyResult>;

export const compareResult = z.object({
  matches: z.enum(['original', 'accepted-copy', 'signed-copy', 'different']),
  fingerprint: z.string(),
  reference: z.string(),
  seal: z
    .object({
      intact: z.boolean(),
      coversWholeFile: z.boolean(),
      sealedByUs: z.boolean(),
      laterSignatures: z.number(),
      timestamp: z.object({ time: z.string(), matchesSignature: z.boolean() }).nullable(),
      reason: z.string().optional(),
    })
    .nullable(),
});
export type CompareResult = z.infer<typeof compareResult>;

/** The candidate's private acceptance page. */
export const acceptInfo = z.object({
  reference: z.string(),
  letterType: z.string(),
  issuedBy: z.string(),
  name: z.string(),
  emailHint: z.string(),
  method: z.enum(['OTP', 'AADHAAR']).default('OTP'),
  status: z.enum(['PENDING', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED']),
  expiresAt: z.string(),
  canAccept: z.boolean(),
});
export type AcceptInfo = z.infer<typeof acceptInfo>;
