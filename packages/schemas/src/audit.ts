import { z } from 'zod';

export const auditListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(120).optional(),
});
export const auditEntry = z.object({
  seq: z.string(),
  actorType: z.enum(['USER', 'PLATFORM', 'SYSTEM']),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export const auditListResponse = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  items: z.array(auditEntry),
});
export const chainCheck = z.object({
  ok: z.boolean(),
  checked: z.number(),
  brokenAtSeq: z.string().optional(),
  reason: z.string().optional(),
});
export type AuditListResponse = z.infer<typeof auditListResponse>;
export type ChainCheck = z.infer<typeof chainCheck>;
