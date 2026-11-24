import { z } from 'zod';

/** Logs, error tracking and alerts (D-67, D-68). */

export const logKinds = ['requests', 'errors', 'signins', 'jobs'] as const;
export type LogKind = (typeof logKinds)[number];

export const signinOutcomes = [
  'SUCCESS',
  'BAD_PASSWORD',
  'LOCKED',
  'MFA_OK',
  'MFA_FAILED',
  'PASSKEY',
  'TRUSTED_DEVICE',
  'SUSPENDED',
] as const;
export const signinOutcome = z.enum(signinOutcomes);
export type SigninOutcome = z.infer<typeof signinOutcome>;

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

const range = {
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
};

export const requestLogQuery = z.object({
  tenantId: z.string().trim().max(36).optional(),
  actorId: z.string().trim().max(36).optional(),
  /** `2xx`, `4xx`, `5xx` or an exact code. */
  status: z.string().trim().max(3).optional(),
  route: z.string().trim().max(200).optional(),
  method: z.string().trim().max(10).optional(),
  requestId: z.string().trim().max(64).optional(),
  ...range,
  ...page,
});
export type RequestLogQuery = z.infer<typeof requestLogQuery>;

export const errorLogQuery = z.object({
  tenantId: z.string().trim().max(36).optional(),
  route: z.string().trim().max(200).optional(),
  requestId: z.string().trim().max(64).optional(),
  /** Matches the message and the plain-English story. */
  q: z.string().trim().max(200).optional(),
  ...range,
  ...page,
});
export type ErrorLogQuery = z.infer<typeof errorLogQuery>;

export const signinLogQuery = z.object({
  tenantId: z.string().trim().max(36).optional(),
  userId: z.string().trim().max(36).optional(),
  outcome: signinOutcome.optional(),
  /** An exact address finds that person's attempts. */
  q: z.string().trim().max(191).optional(),
  ...range,
  ...page,
});
export type SigninLogQuery = z.infer<typeof signinLogQuery>;

export const jobLogQuery = z.object({
  tenantId: z.string().trim().max(36).optional(),
  status: z.enum(['PENDING', 'DONE', 'FAILED']).optional(),
  name: z.string().trim().max(100).optional(),
  ...range,
  ...page,
});
export type JobLogQuery = z.infer<typeof jobLogQuery>;

const paged = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });

export const requestLogItem = z.object({
  id: z.string(),
  requestId: z.string(),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
  actorType: z.string().nullable(),
  actorId: z.string().nullable(),
  method: z.string(),
  routePattern: z.string(),
  status: z.number(),
  durationMs: z.number(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
});
export const requestLogResponse = paged(requestLogItem);
export type RequestLogItem = z.infer<typeof requestLogItem>;
export type RequestLogResponse = z.infer<typeof requestLogResponse>;

export const errorLogItem = z.object({
  id: z.string(),
  requestId: z.string().nullable(),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
  routePattern: z.string().nullable(),
  errorCode: z.string(),
  message: z.string(),
  /** Plain-English account of what happened and what to do. */
  story: z.string(),
  /** Only present for people who may see technical detail. */
  stack: z.string().nullable(),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export const errorLogResponse = paged(errorLogItem);
export type ErrorLogItem = z.infer<typeof errorLogItem>;
export type ErrorLogResponse = z.infer<typeof errorLogResponse>;

export const signinLogItem = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
  userId: z.string().nullable(),
  outcome: signinOutcome,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
});
export const signinLogResponse = paged(signinLogItem);
export type SigninLogItem = z.infer<typeof signinLogItem>;
export type SigninLogResponse = z.infer<typeof signinLogResponse>;

export const jobLogItem = z.object({
  id: z.string(),
  tenantId: z.string(),
  tenantName: z.string().nullable(),
  name: z.string(),
  status: z.enum(['PENDING', 'DONE', 'FAILED']),
  attempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const jobLogResponse = paged(jobLogItem);
export type JobLogItem = z.infer<typeof jobLogItem>;
export type JobLogResponse = z.infer<typeof jobLogResponse>;

export const traceEntry = z.object({
  at: z.string(),
  kind: z.enum(['request', 'error', 'signin', 'job', 'mail', 'audit']),
  title: z.string(),
  detail: z.string().nullable(),
  /** `ok`, `warn` or `bad`, for the dot colour. */
  tone: z.enum(['ok', 'warn', 'bad']),
});
export const traceResponse = z.object({
  requestId: z.string(),
  entries: z.array(traceEntry),
});
export type TraceEntry = z.infer<typeof traceEntry>;
export type TraceResponse = z.infer<typeof traceResponse>;

/** A short, sanitised summary a person can paste into a message to support. */
export const supportCopy = z.object({ text: z.string() });

// ---------------------------------------------------------------- alerts

export const alertEvents = [
  'ERROR_SPIKE',
  'JOB_FAILING',
  'MAIL_FAILING',
  'AUDIT_CHAIN_BROKEN',
  'SIGNIN_ATTACK',
  'DISK_LOW',
  'SENDER_DNS_BROKEN',
] as const;
export const alertEvent = z.enum(alertEvents);
export type AlertEvent = (typeof alertEvents)[number];

export const alertDelivery = z.enum(['INSTANT', 'DIGEST', 'OFF']);
export type AlertDelivery = z.infer<typeof alertDelivery>;

/** What each alert means, and whether a company admin may subscribe to it. */
export const ALERT_INFO: Record<AlertEvent, { label: string; hint: string; tenant: boolean }> = {
  ERROR_SPIKE: {
    label: 'Many errors in a short time',
    hint: 'The app is failing for several people at once',
    tenant: true,
  },
  JOB_FAILING: {
    label: 'Background work keeps failing',
    hint: 'Letters, emails or other queued work stopped going through',
    tenant: true,
  },
  MAIL_FAILING: {
    label: 'Email is not being delivered',
    hint: 'Several emails in a row failed to send',
    tenant: true,
  },
  AUDIT_CHAIN_BROKEN: {
    label: 'Audit trail was tampered with',
    hint: 'The nightly check found a break in the tamper-evident audit chain',
    tenant: true,
  },
  SIGNIN_ATTACK: {
    label: 'Many failed sign-ins',
    hint: 'Someone may be guessing passwords',
    tenant: true,
  },
  DISK_LOW: {
    label: 'Server disk is nearly full',
    hint: 'The server is running out of space',
    tenant: false,
  },
  SENDER_DNS_BROKEN: {
    label: 'A company’s email sender stopped verifying',
    hint: 'Its SPF, DKIM or DMARC records changed or went missing',
    tenant: true,
  },
};

export const alertSubscription = z.object({
  event: alertEvent,
  delivery: alertDelivery,
});
export const alertSubscriptionsResponse = z.object({
  items: z.array(
    z.object({
      event: alertEvent,
      label: z.string(),
      hint: z.string(),
      delivery: alertDelivery,
    }),
  ),
});
export const saveAlertsBody = z.object({
  items: z.array(alertSubscription).max(20),
});
export type AlertSubscriptionsResponse = z.infer<typeof alertSubscriptionsResponse>;
export type SaveAlertsBody = z.infer<typeof saveAlertsBody>;
