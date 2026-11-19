import { z } from 'zod';

export const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const uploadQuery = z.object({
  name: z.string().trim().min(1).max(255),
  ownerType: z.string().max(60).optional(),
  ownerId: z.string().max(64).optional(),
});
export const fileResponse = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  createdAt: z.string(),
  downloadUrl: z.string().optional(),
  downloadUrlExpiresAt: z.string().optional(),
});
export type FileResponse = z.infer<typeof fileResponse>;
