import { z } from 'zod';

/** The public API and its OAuth clients (D-20). */

export const API_SCOPES = [
  { key: 'employees:read', label: 'Read employees and interns' },
  { key: 'letters:read', label: 'Read letters and their status' },
  { key: 'letters:create', label: 'Create letters' },
] as const;
export type ApiScope = (typeof API_SCOPES)[number]['key'];
export const apiScope = z.enum(API_SCOPES.map((s) => s.key) as [ApiScope, ...ApiScope[]]);

export const apiClientBody = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(apiScope).min(1, 'Choose at least one permission').max(10),
  /** Null: every company in this tenant. */
  entityIds: z.array(z.string().uuid()).max(100).nullable().default(null),
  rateLimitPerMinute: z.number().int().min(1).max(6000).default(60),
  active: z.boolean().default(true),
});
export type ApiClientBody = z.infer<typeof apiClientBody>;

export const apiClientView = z.object({
  id: z.string(),
  name: z.string(),
  clientId: z.string(),
  secretLast4: z.string(),
  scopes: z.array(apiScope),
  entityIds: z.array(z.string()).nullable(),
  rateLimitPerMinute: z.number().int(),
  active: z.boolean(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiClientView = z.infer<typeof apiClientView>;

/** Shown once, when a client is made or its secret is rotated. */
export const apiClientCreated = apiClientView.extend({ clientSecret: z.string() });
export type ApiClientCreated = z.infer<typeof apiClientCreated>;

export const tokenRequest = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1).max(60),
  client_secret: z.string().min(1).max(200),
  /** Space separated. Left out: everything the client may do. */
  scope: z.string().max(300).optional(),
});
export type TokenRequest = z.infer<typeof tokenRequest>;

/** Outbound webhooks (D-20). */
export const WEBHOOK_EVENTS = [
  { key: 'employee.created', label: 'A person is added' },
  { key: 'employee.updated', label: 'A person’s details change' },
  { key: 'letter.created', label: 'A letter is created' },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]['key'];
export const webhookEvent = z.enum(
  WEBHOOK_EVENTS.map((e) => e.key) as [WebhookEvent, ...WebhookEvent[]],
);

export const webhookBody = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https:\/\//i.test(u) || /^http:\/\/localhost(:\d+)?\//i.test(u), {
      message: 'Use an https address',
    }),
  description: z.string().trim().max(120).default(''),
  events: z.array(webhookEvent).min(1, 'Choose at least one event').max(20),
  active: z.boolean().default(true),
});
export type WebhookBody = z.infer<typeof webhookBody>;

export const webhookView = z.object({
  id: z.string(),
  url: z.string(),
  description: z.string(),
  events: z.array(webhookEvent),
  active: z.boolean(),
  createdAt: z.string(),
  /** Deliveries that gave up after every retry, in the last 7 days. */
  recentFailures: z.number().int(),
});
export type WebhookView = z.infer<typeof webhookView>;

export const webhookCreated = webhookView.extend({ secret: z.string() });
export type WebhookCreated = z.infer<typeof webhookCreated>;

export const webhookDeliveryView = z.object({
  id: z.string(),
  eventType: z.string(),
  status: z.enum(['PENDING', 'DELIVERED', 'FAILED']),
  attempts: z.number().int(),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  at: z.string(),
  nextAttemptAt: z.string().nullable(),
});
export type WebhookDeliveryView = z.infer<typeof webhookDeliveryView>;
