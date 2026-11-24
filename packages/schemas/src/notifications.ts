import { z } from 'zod';

export const notificationItem = z.object({
  id: z.string(),
  event: z.string(),
  toEmail: z.string(),
  subject: z.string(),
  status: z.enum(['QUEUED', 'SENT', 'FAILED']),
  error: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof notificationItem>;

/** Who is told about which event (D-69). `roleKey` is a role's key, or SUBJECT for the person concerned. */
export const ruleCell = z.object({
  event: z.string().max(60),
  roleKey: z.string().max(60),
  channel: z.enum(['EMAIL', 'IN_APP']),
  enabled: z.boolean(),
});
export const ruleMatrix = z.object({
  events: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string(),
      subject: z.boolean(),
    }),
  ),
  roles: z.array(z.object({ key: z.string(), name: z.string() })),
  cells: z.array(ruleCell),
});
export const saveRulesBody = z.object({ cells: z.array(ruleCell).max(500) });
export type RuleCell = z.infer<typeof ruleCell>;
export type RuleMatrix = z.infer<typeof ruleMatrix>;
export type SaveRulesBody = z.infer<typeof saveRulesBody>;
