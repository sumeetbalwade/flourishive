import { z } from 'zod';

/** Platform controls (D-70): announcements, maintenance, feature switches, usage, export and import. */

/** Modules the super admin can switch off for a company. Everything is on until switched off. */
export const FEATURES = [
  {
    key: 'documents',
    label: 'Letters and documents',
    hint: 'Templates, letters and the document register',
  },
  {
    key: 'letters.bulk',
    label: 'Bulk letters',
    hint: 'Issue many letters from a spreadsheet at once',
  },
  {
    key: 'signing.dsc',
    label: 'Signing with a DSC token',
    hint: 'Digital signature token on the desktop app',
  },
  {
    key: 'signing.otp',
    label: 'Acceptance by email code',
    hint: 'Recipients accept with a code sent to their email',
  },
  { key: 'signing.aadhaar', label: 'Aadhaar eSign', hint: 'Recipients sign with Aadhaar OTP' },
  { key: 'people.import', label: 'Import people', hint: 'Add many people from a spreadsheet' },
  { key: 'org', label: 'Organisation', hint: 'Departments, designations and locations' },
] as const;
export type FeatureKey = (typeof FEATURES)[number]['key'];
export const featureKey = z.enum(FEATURES.map((f) => f.key) as [FeatureKey, ...FeatureKey[]]);

export const announcementTone = z.enum(['INFO', 'WARNING', 'CRITICAL']);

export const announcementBody = z
  .object({
    message: z.string().trim().min(1).max(500),
    tone: announcementTone.default('INFO'),
    /** null or left out: every company. */
    tenantIds: z.array(z.string().uuid()).max(500).nullable().default(null),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    dismissible: z.boolean().default(true),
  })
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type AnnouncementBody = z.infer<typeof announcementBody>;

export const announcementView = z.object({
  id: z.string(),
  message: z.string(),
  tone: announcementTone,
  tenantIds: z.array(z.string()).nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  dismissible: z.boolean(),
  createdAt: z.string(),
});
export type AnnouncementView = z.infer<typeof announcementView>;

/** What a company's people see: only what is showing now. */
export const activeAnnouncement = announcementView.pick({
  id: true,
  message: true,
  tone: true,
  dismissible: true,
});
export type ActiveAnnouncement = z.infer<typeof activeAnnouncement>;

export const maintenanceState = z.object({
  enabled: z.boolean(),
  message: z.string().max(500),
  /** When it is expected to end, shown to people. */
  until: z.string().datetime().nullable(),
});
export type MaintenanceState = z.infer<typeof maintenanceState>;

export const setFeatureBody = z.object({ enabled: z.boolean() });

export const featureStateView = z.object({
  features: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      hint: z.string(),
      enabled: z.boolean(),
    }),
  ),
});
export type FeatureStateView = z.infer<typeof featureStateView>;

export const usagePoint = z.object({
  day: z.string(),
  users: z.number(),
  activeUsers30d: z.number(),
  people: z.number(),
  lettersMonth: z.number(),
  storageBytes: z.number(),
  emailsSent: z.number(),
  lastActivityAt: z.string().nullable(),
});
export type UsagePoint = z.infer<typeof usagePoint>;

export const usageOverview = z.object({
  tenants: z.array(
    z.object({
      tenantId: z.string(),
      slug: z.string(),
      name: z.string(),
      latest: usagePoint.nullable(),
      /** Last 30 days of active users, oldest first, for the sparkline. */
      trend: z.array(z.number()),
    }),
  ),
});
export type UsageOverview = z.infer<typeof usageOverview>;

export const usageDetail = z.object({ points: z.array(usagePoint) });

/** A company's setup, without secrets or people (D-70). */
export const tenantExport = z.object({
  format: z.literal('flourishive-tenant-setup'),
  version: z.literal(1),
  exportedAt: z.string(),
  source: z.object({ slug: z.string(), name: z.string() }),
  settings: z.record(z.string(), z.unknown()),
  brand: z
    .object({
      data: z.record(z.string(), z.unknown()),
      assets: z.array(
        z.object({
          kind: z.enum(['LOGO_LIGHT', 'LOGO_DARK', 'FAVICON', 'PANEL_IMAGE']),
          mimeType: z.string(),
          base64: z.string(),
        }),
      ),
    })
    .nullable(),
  emailTemplates: z.array(z.object({ event: z.string(), subject: z.string(), body: z.string() })),
  notificationRules: z.array(
    z.object({
      event: z.string(),
      roleKey: z.string(),
      channel: z.string(),
      enabled: z.boolean(),
    }),
  ),
  rolePolicies: z.array(
    z.object({
      roleKey: z.string(),
      mfaLevel: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
      recoveryEmail: z.boolean(),
      recoveryCodes: z.boolean(),
    }),
  ),
  features: z.record(z.string(), z.boolean()),
});
export type TenantExport = z.infer<typeof tenantExport>;

export const setupImportBody = z.object({
  file: tenantExport,
  /** Preview only; nothing is changed. */
  dryRun: z.boolean().default(true),
});

export const setupImportResult = z.object({
  dryRun: z.boolean(),
  /** One line per thing that would change or did change. */
  changes: z.array(z.object({ area: z.string(), text: z.string() })),
  skipped: z.array(z.string()),
});
export type SetupImportResult = z.infer<typeof setupImportResult>;

/** The first admin's "Finish setting up" list, driven by what is still at its default (D-71). */
export const setupChecklist = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      hint: z.string(),
      done: z.boolean(),
      /** Where to go, as a web app path such as /app/brand. */
      href: z.string(),
    }),
  ),
  allDone: z.boolean(),
});
export type SetupChecklist = z.infer<typeof setupChecklist>;
