import { z } from 'zod';

/** Email senders and the delivery log (D-58, D-60). */
export const senderKind = z.enum(['PLATFORM_DEFAULT', 'VERIFIED_FROM', 'OWN_SMTP']);
export const senderStatus = z.enum(['DRAFT', 'VERIFYING', 'ACTIVE', 'FAILED']);
export const deliveryStatus = z.enum(['QUEUED', 'SENT', 'FAILED']);

const emailAddress = z.string().trim().toLowerCase().email().max(191);

export const smtpInput = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(255),
  /** Leave out to keep the saved password. */
  pass: z.string().min(1).max(512).optional(),
});

export const saveSenderBody = z
  .object({
    kind: z.enum(['VERIFIED_FROM', 'OWN_SMTP']),
    fromName: z.string().trim().min(1).max(120),
    fromAddress: emailAddress,
    replyTo: emailAddress.optional().or(z.literal('').transform(() => undefined)),
    smtp: smtpInput.optional(),
  })
  .refine((b) => b.kind !== 'OWN_SMTP' || b.smtp, {
    message: 'Enter the mail server details',
    path: ['smtp'],
  });
export type SaveSenderBody = z.infer<typeof saveSenderBody>;

export const confirmSenderCodeBody = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const dnsCheckBody = z.object({
  dkimSelector: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]{1,63}$/, 'Letters, numbers, dots and dashes only')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const dnsCheck = z.object({
  name: z.enum(['SPF', 'DKIM', 'DMARC']),
  state: z.enum(['pass', 'warn']),
  found: z.string(),
  hint: z.string(),
});
export const dnsReport = z.object({
  domain: z.string(),
  checkedAt: z.string(),
  checks: z.array(dnsCheck),
});
export type DnsReportView = z.infer<typeof dnsReport>;

export const senderView = z.object({
  id: z.string(),
  kind: senderKind,
  fromName: z.string(),
  fromAddress: z.string(),
  replyTo: z.string().nullable(),
  smtp: z
    .object({
      host: z.string(),
      port: z.number(),
      secure: z.boolean(),
      user: z.string(),
      passwordSet: z.boolean(),
    })
    .nullable(),
  status: senderStatus,
  codeConfirmed: z.boolean(),
  verifiedAt: z.string().nullable(),
  lastTestAt: z.string().nullable(),
  lastTestResult: z.string().nullable(),
  dnsReport: dnsReport.nullable(),
});
export type SenderView = z.infer<typeof senderView>;

export const senderState = z.object({
  /** Where mail goes from when the company has no active sender of its own. */
  defaultFrom: z.string(),
  sender: senderView.nullable(),
});
export type SenderState = z.infer<typeof senderState>;

export const testResult = z.object({ ok: z.boolean(), message: z.string() });

export const deliveryQuery = z.object({
  event: z.string().trim().max(60).optional(),
  status: deliveryStatus.optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  /** An exact address finds that person's mail; anything else matches the masked address. */
  q: z.string().trim().max(191).optional(),
  tenantId: z.string().trim().max(36).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type DeliveryQuery = z.infer<typeof deliveryQuery>;

export const deliveryItem = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
  event: z.string(),
  to: z.string(),
  status: deliveryStatus,
  error: z.string().nullable(),
  attempts: z.number(),
  requestId: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  canResend: z.boolean(),
});
export const deliveriesResponse = z.object({
  items: z.array(deliveryItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type DeliveryItem = z.infer<typeof deliveryItem>;
export type DeliveriesResponse = z.infer<typeof deliveriesResponse>;

/** Email wording (D-59). */
export const templateSource = z.enum(['company', 'platform', 'default']);

export const templateListItem = z.object({
  event: z.string(),
  label: z.string(),
  description: z.string(),
  source: templateSource,
  /** The platform has locked this email's wording, so a company cannot change it. */
  locked: z.boolean(),
  /** A company may not reword this one (platform-owned or locked). */
  readOnly: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type TemplateListItem = z.infer<typeof templateListItem>;
export const templateList = z.object({ items: z.array(templateListItem) });

export const templateVariable = z.object({
  name: z.string(),
  description: z.string(),
  sample: z.string(),
});

export const templateView = z.object({
  event: z.string(),
  label: z.string(),
  description: z.string(),
  source: templateSource,
  locked: z.boolean(),
  readOnly: z.boolean(),
  subject: z.string(),
  body: z.string(),
  defaultSubject: z.string(),
  defaultBody: z.string(),
  variables: z.array(templateVariable),
  required: z.array(z.string()),
  updatedAt: z.string().nullable(),
});
export type TemplateView = z.infer<typeof templateView>;

export const saveTemplateBody = z.object({
  subject: z.string().trim().min(1, 'Enter a subject').max(300),
  body: z.string().trim().min(1, 'Enter the message').max(8000),
  /** Platform only: stop companies from rewording this email. */
  locked: z.boolean().optional(),
});
export type SaveTemplateBody = z.infer<typeof saveTemplateBody>;

export const previewTemplateBody = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().max(8000).optional(),
  scheme: z.enum(['light', 'dark']).default('light'),
});
export type PreviewTemplateBody = z.infer<typeof previewTemplateBody>;

export const previewResponse = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  problems: z.array(z.string()),
});
export type PreviewResponse = z.infer<typeof previewResponse>;

export const testTemplateBody = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().max(8000).optional(),
});
export type TestTemplateBody = z.infer<typeof testTemplateBody>;
