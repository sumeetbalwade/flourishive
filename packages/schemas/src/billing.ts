import { z } from 'zod';

/** Plans and limits (D-20). A limit is a whole number, or null for unlimited. */

export const LIMIT_METRICS = [
  { key: 'users', label: 'People with an account', unit: 'accounts' },
  { key: 'storage_mb', label: 'File storage', unit: 'MB' },
  { key: 'signatures_month', label: 'Signature requests each month', unit: 'requests' },
] as const;
export type LimitMetric = (typeof LIMIT_METRICS)[number]['key'];
export const limitMetric = z.enum(
  LIMIT_METRICS.map((m) => m.key) as [LimitMetric, ...LimitMetric[]],
);

export const limitValue = z.number().int().min(0).max(1_000_000_000).nullable();
export const limitMap = z.object({
  users: limitValue,
  storage_mb: limitValue,
  signatures_month: limitValue,
});
export type LimitMap = z.infer<typeof limitMap>;

export const subscriptionStatus = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'READ_ONLY',
  'SUSPENDED',
  'CANCELLED',
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;

export const planBody = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9-]{1,38}$/, 'Use lowercase letters, digits and dashes'),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  /** In paise (1/100 of a rupee). */
  priceMonthly: z.number().int().min(0).max(100_000_000),
  priceYearly: z.number().int().min(0).max(1_000_000_000),
  isPublic: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  limits: limitMap,
});
export type PlanBody = z.infer<typeof planBody>;

export const planView = planBody.extend({
  id: z.string(),
  currency: z.string(),
  /** Companies on this plan. */
  companies: z.number().int(),
});
export type PlanView = z.infer<typeof planView>;

export const assignPlanBody = z.object({
  planId: z.string().uuid(),
  /** Replaces the plan's limit for a metric on this company only. Leave a metric out to follow the plan. */
  limitOverrides: limitMap.partial().nullable().default(null),
  status: subscriptionStatus.default('ACTIVE'),
});
export type AssignPlanBody = z.infer<typeof assignPlanBody>;

export const usageNow = z.object({
  users: z.number().int(),
  storage_mb: z.number(),
  signatures_month: z.number().int(),
});
export type UsageNow = z.infer<typeof usageNow>;

/** One company's plan, what it may use and what it has used. */
export const subscriptionView = z.object({
  plan: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  status: subscriptionStatus,
  limits: limitMap,
  /** Metrics where this company's limit differs from the plan's. */
  overridden: z.array(limitMetric),
  usage: usageNow,
});
export type SubscriptionView = z.infer<typeof subscriptionView>;

/** The body of the 402 answer when a plan limit is reached. */
export const planLimitError = z.object({
  code: z.literal('PLAN_LIMIT'),
  metric: limitMetric,
  limit: z.number(),
  used: z.number(),
  message: z.string(),
});
export type PlanLimitError = z.infer<typeof planLimitError>;

export const billingInterval = z.enum(['MONTHLY', 'YEARLY']);
export type BillingInterval = z.infer<typeof billingInterval>;

export const checkoutBody = z.object({
  planId: z.string().uuid(),
  interval: billingInterval,
});
export type CheckoutBody = z.infer<typeof checkoutBody>;

/** What the browser needs to open the payment window. */
export const checkoutView = z.object({
  subscriptionId: z.string(),
  keyId: z.string(),
  name: z.string(),
  description: z.string(),
});
export type CheckoutView = z.infer<typeof checkoutView>;

export const confirmBody = z.object({
  razorpay_payment_id: z.string().min(1).max(80),
  razorpay_subscription_id: z.string().min(1).max(80),
  razorpay_signature: z.string().min(1).max(200),
});
export type ConfirmBody = z.infer<typeof confirmBody>;

export const paymentView = z.object({
  id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(['CAPTURED', 'FAILED', 'REFUNDED']),
  method: z.string().nullable(),
  failureReason: z.string().nullable(),
  at: z.string(),
});
export type PaymentView = z.infer<typeof paymentView>;

/** The company's billing state beyond limits: interval, renewal, whether payment is possible. */
export const billingState = z.object({
  paymentsEnabled: z.boolean(),
  interval: billingInterval.nullable(),
  renewsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  hasSubscription: z.boolean(),
  /** Set once the company has told us who to invoice. Needed before paying. */
  profileComplete: z.boolean(),
  /** Days left before read-only mode while a payment is overdue. */
  graceEndsAt: z.string().nullable(),
  payments: z.array(paymentView),
});
export type BillingState = z.infer<typeof billingState>;

/** Who invoices are made out to. */
export const billingProfileBody = z.object({
  legalName: z.string().trim().min(2).max(191),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Not a valid GSTIN')
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null),
  address: z.string().trim().min(5).max(500),
  stateCode: z.string().regex(/^\d{2}$/, 'Two digits, for example 27'),
  billingEmail: z.string().trim().toLowerCase().email().max(191),
});
export type BillingProfileBody = z.infer<typeof billingProfileBody>;

export const invoiceView = z.object({
  id: z.string(),
  number: z.string(),
  description: z.string(),
  issuedAt: z.string(),
  taxableValue: z.number().int(),
  cgst: z.number().int(),
  sgst: z.number().int(),
  igst: z.number().int(),
  total: z.number().int(),
});
export type InvoiceView = z.infer<typeof invoiceView>;

export const invoiceLinkView = z.object({ url: z.string(), expiresAt: z.string() });

/** The super admin's billing dashboard. */
export const billingOverview = z.object({
  totals: z.object({
    companies: z.number().int(),
    paying: z.number().int(),
    pastDue: z.number().int(),
    readOnly: z.number().int(),
    suspended: z.number().int(),
    /** Monthly recurring revenue in paise (yearly plans counted as a twelfth). */
    mrr: z.number().int(),
  }),
  /** Companies at 80% or more of a limit, worst first. */
  nearLimit: z.array(
    z.object({
      tenantId: z.string(),
      name: z.string(),
      plan: z.string(),
      metric: limitMetric,
      used: z.number(),
      limit: z.number(),
      percent: z.number(),
    }),
  ),
  /** Payment-provider webhooks that failed to process. */
  failures: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      error: z.string(),
      at: z.string(),
    }),
  ),
});
export type BillingOverview = z.infer<typeof billingOverview>;
