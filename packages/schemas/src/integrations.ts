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
