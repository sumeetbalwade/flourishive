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
