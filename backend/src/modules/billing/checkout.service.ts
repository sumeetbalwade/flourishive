import type {
  BillingState,
  CheckoutBody,
  CheckoutView,
  ConfirmBody,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { InvoiceService } from './invoice.service.js';
import { LimitsService } from './limits.service.js';
import { PlansService } from './plans.service.js';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './gateway/payment-gateway.js';

const fromUnix = (n: unknown) =>
  typeof n === 'number' ? new Date(n * 1000) : null;

interface RzpSubscription {
  id: string;
  current_start?: number;
  current_end?: number;
}
interface RzpPayment {
  id: string;
  amount: number;
  currency?: string;
  method?: string;
  error_description?: string;
}
interface RzpEvent {
  event: string;
  payload: {
    subscription?: { entity: RzpSubscription };
    payment?: { entity: RzpPayment };
  };
}

/**
 * Paid subscriptions through the payment gateway (D-21). A company starts a checkout, authorises
 * the mandate in the provider's window, and the provider's webhooks keep the plan and status true.
 */
@Injectable()
export class CheckoutService {
  private readonly log = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly limits: LimitsService,
    private readonly invoices: InvoiceService,
    private readonly redis: RedisService,
    private readonly runtime: RuntimeConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async state(tenantId: string): Promise<BillingState> {
    const [sub, payments, enabled, profile, graceDays] = await Promise.all([
      runInTenant(tenantId, async () =>
        this.prisma.db.subscription.findUnique({ where: { tenantId } }),
      ),
      runInTenant(tenantId, async () =>
        this.prisma.db.payment.findMany({
          orderBy: { createdAt: 'desc' },
          take: 24,
        }),
      ),
      this.gateway.configured(),
      this.invoices.profile(tenantId),
      this.runtime.get('BILLING_GRACE_DAYS'),
    ]);
    return {
      paymentsEnabled: enabled,
      interval: sub?.billingInterval ?? null,
      renewsAt: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      hasSubscription: Boolean(
        sub?.gatewaySubscriptionId && !sub.pendingPlanId,
      ),
      profileComplete: Boolean(profile),
      graceEndsAt:
        sub?.status === 'PAST_DUE' && sub.pastDueSince
          ? new Date(
              sub.pastDueSince.getTime() + (graceDays ?? 7) * 86_400_000,
            ).toISOString()
          : null,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        method: p.method,
        failureReason: p.failureReason,
        at: (p.paidAt ?? p.createdAt).toISOString(),
      })),
    };
  }

  /** Creates the provider subscription for the chosen plan and remembers what the company is moving to. */
  async checkout(tenantId: string, b: CheckoutBody): Promise<CheckoutView> {
    const plan = await this.plans.get(b.planId);
    if (!plan.active || !plan.isPublic)
      throw new BadRequestException('That plan is not available');
    const amount =
      b.interval === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
    if (amount <= 0)
      throw new BadRequestException(
        'That plan is free. Ask your administrator to switch to it.',
      );
    if (!(await this.invoices.profile(tenantId)))
      throw new BadRequestException(
        'Add your billing details first, so we can issue a GST invoice',
      );
    const current = await runInTenant(tenantId, async () =>
      this.prisma.db.subscription.findUnique({ where: { tenantId } }),
    );
    if (current?.gatewaySubscriptionId && !current.cancelAtPeriodEnd)
      throw new BadRequestException(
        'You already have a paid subscription. Cancel it first to change plan.',
      );
    const gatewayPlanId = await this.gatewayPlan(plan, b.interval, amount);
    const sub = await this.gateway.createSubscription({
      gatewayPlanId,
      totalCount: b.interval === 'YEARLY' ? 10 : 120,
      notes: { tenantId, planKey: plan.key },
    });
    await runAsSystem(async () =>
      this.prisma.db.subscription.upsert({
        where: { tenantId },
        update: {
          gatewaySubscriptionId: sub.id,
          pendingPlanId: plan.id,
          billingInterval: b.interval,
          cancelAtPeriodEnd: false,
        },
        create: {
          tenantId,
          planId: plan.id,
          gatewaySubscriptionId: sub.id,
          pendingPlanId: plan.id,
          billingInterval: b.interval,
        },
      }),
    );
    return {
      subscriptionId: sub.id,
      keyId: await this.gateway.publicKey(),
      name: 'Flourishive',
      description: `${plan.name} plan, billed ${b.interval === 'YEARLY' ? 'yearly' : 'monthly'}`,
    };
  }

  private async gatewayPlan(
    plan: { id: string; name: string },
    interval: 'MONTHLY' | 'YEARLY',
    amount: number,
  ): Promise<string> {
    const key = {
      planId_interval_amount: { planId: plan.id, interval, amount },
    };
    const found = await runAsSystem(async () =>
      this.prisma.db.gatewayPlanRef.findUnique({ where: key }),
    );
    if (found) return found.gatewayPlanId;
    const id = await this.gateway.createPlan({
      name: `${plan.name} (${interval.toLowerCase()})`,
      interval,
      amount,
    });
    await runAsSystem(async () =>
      this.prisma.db.gatewayPlanRef.create({
        data: { planId: plan.id, interval, amount, gatewayPlanId: id },
      }),
    );
    return id;
  }

  /** The browser reports the authorised mandate. Only a valid signature moves the company to the paid plan. */
  async confirm(tenantId: string, b: ConfirmBody): Promise<BillingState> {
    const sub = await runInTenant(tenantId, async () =>
      this.prisma.db.subscription.findUnique({ where: { tenantId } }),
    );
    if (!sub || sub.gatewaySubscriptionId !== b.razorpay_subscription_id)
      throw new NotFoundException(
        'That checkout does not belong to your company',
      );
    const ok = await this.gateway.verifyCheckout({
      paymentId: b.razorpay_payment_id,
      subscriptionId: b.razorpay_subscription_id,
      signature: b.razorpay_signature,
    });
    if (!ok) throw new BadRequestException('The payment could not be verified');
    await this.activate(sub.gatewaySubscriptionId!, {});
    return this.state(tenantId);
  }

  /** Cancels at the end of the paid period. The company keeps the plan until then. */
  async cancel(tenantId: string): Promise<BillingState> {
    const sub = await runInTenant(tenantId, async () =>
      this.prisma.db.subscription.findUnique({ where: { tenantId } }),
    );
    if (!sub?.gatewaySubscriptionId)
      throw new BadRequestException('There is no paid subscription to cancel');
    await this.gateway.cancelSubscription(sub.gatewaySubscriptionId, true);
    await runAsSystem(async () =>
      this.prisma.db.subscription.update({
        where: { tenantId },
        data: { cancelAtPeriodEnd: true },
      }),
    );
    await this.limits.clear(tenantId);
    return this.state(tenantId);
  }

  // Webhooks ------------------------------------------------------------------------------------

  /** Handles one verified webhook exactly once. Returns false when it was already handled. */
  async handleWebhook(eventId: string, event: RzpEvent): Promise<boolean> {
    try {
      await runAsSystem(async () =>
        this.prisma.db.billingEvent.create({
          data: {
            gatewayEventId: eventId,
            type: event.event,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const prior = await runAsSystem(async () =>
          this.prisma.db.billingEvent.findUnique({
            where: { gatewayEventId: eventId },
          }),
        );
        if (prior?.processedAt) return false; // already done
      } else throw e;
    }
    try {
      await this.apply(event);
      await runAsSystem(async () =>
        this.prisma.db.billingEvent.update({
          where: { gatewayEventId: eventId },
          data: { processedAt: new Date(), error: null },
        }),
      );
    } catch (e) {
      await runAsSystem(async () =>
        this.prisma.db.billingEvent.update({
          where: { gatewayEventId: eventId },
          data: { error: String((e as Error).message).slice(0, 500) },
        }),
      );
      throw e;
    }
    return true;
  }

  /** Runs a webhook that failed before again, from the copy we kept. */
  async retryEvent(id: string): Promise<void> {
    const ev = await runAsSystem(async () =>
      this.prisma.db.billingEvent.findUnique({ where: { id } }),
    );
    if (!ev) throw new NotFoundException('That event does not exist');
    await this.apply(ev.payload as unknown as RzpEvent);
    await runAsSystem(async () =>
      this.prisma.db.billingEvent.update({
        where: { id },
        data: { processedAt: new Date(), error: null },
      }),
    );
  }

  private async apply(event: RzpEvent): Promise<void> {
    const sub = event.payload.subscription?.entity;
    if (!sub) return;
    switch (event.event) {
      case 'subscription.activated':
        await this.activate(sub.id, { sub });
        break;
      case 'subscription.charged':
        await this.activate(sub.id, {
          sub,
          payment: event.payload.payment?.entity,
        });
        break;
      case 'subscription.pending':
        await this.setStatus(sub.id, 'PAST_DUE');
        break;
      case 'subscription.halted':
        await this.setStatus(sub.id, 'READ_ONLY');
        break;
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired':
        await this.ended(sub.id);
        break;
      default:
        this.log.debug(`Ignoring ${event.event}`);
    }
  }

  private async byGatewayId(gatewaySubscriptionId: string) {
    return runAsSystem(async () =>
      this.prisma.db.subscription.findUnique({
        where: { gatewaySubscriptionId },
      }),
    );
  }

  /** The mandate is live or a charge succeeded: move to the chosen plan, record the payment. Safe to repeat. */
  private async activate(
    gatewaySubscriptionId: string,
    x: { sub?: RzpSubscription; payment?: RzpPayment },
  ): Promise<void> {
    const row = await this.byGatewayId(gatewaySubscriptionId);
    if (!row) return;
    await runAsSystem(async () =>
      this.prisma.db.subscription.update({
        where: { id: row.id },
        data: {
          planId: row.pendingPlanId ?? row.planId,
          pendingPlanId: null,
          status: 'ACTIVE',
          pastDueSince: null,
          lastReminderAt: null,
          reminderCount: 0,
          currentPeriodStart:
            fromUnix(x.sub?.current_start) ?? row.currentPeriodStart,
          currentPeriodEnd:
            fromUnix(x.sub?.current_end) ?? row.currentPeriodEnd,
        },
      }),
    );
    if (x.payment) {
      const paid = await runAsSystem(async () =>
        this.prisma.db.payment.upsert({
          where: { gatewayPaymentId: x.payment!.id },
          update: {},
          create: {
            tenantId: row.tenantId,
            gatewayPaymentId: x.payment!.id,
            amount: x.payment!.amount,
            currency: x.payment!.currency ?? 'INR',
            status: 'CAPTURED',
            method: x.payment!.method ?? null,
            paidAt: new Date(),
          },
        }),
      );
      await this.invoices.issueForPayment(paid.id);
    }
    if (row.status === 'SUSPENDED') await this.unsuspend(row.tenantId);
    await this.limits.clear(row.tenantId);
  }

  /** Payment came in after a billing suspension: let the company back in. */
  async unsuspend(tenantId: string): Promise<void> {
    await runAsSystem(async () =>
      this.prisma.db.tenant.update({
        where: { id: tenantId },
        data: { status: 'ACTIVE' },
      }),
    );
    await this.redis.del(`tenant:suspended:${tenantId}`);
  }

  private async setStatus(
    gatewaySubscriptionId: string,
    status: 'PAST_DUE' | 'READ_ONLY',
  ): Promise<void> {
    const row = await this.byGatewayId(gatewaySubscriptionId);
    if (!row) return;
    await runAsSystem(async () =>
      this.prisma.db.subscription.update({
        where: { id: row.id },
        data: { status, pastDueSince: row.pastDueSince ?? new Date() },
      }),
    );
    await this.limits.clear(row.tenantId);
  }

  /** The paid subscription ended: back to the default plan. */
  private async ended(gatewaySubscriptionId: string): Promise<void> {
    const row = await this.byGatewayId(gatewaySubscriptionId);
    if (!row) return;
    const fallback = await this.plans.defaultPlanId();
    await runAsSystem(async () =>
      this.prisma.db.subscription.update({
        where: { id: row.id },
        data: {
          planId: fallback ?? row.planId,
          status: 'ACTIVE',
          gatewaySubscriptionId: null,
          pendingPlanId: null,
          billingInterval: null,
          cancelAtPeriodEnd: false,
          currentPeriodStart: null,
          currentPeriodEnd: null,
        },
      }),
    );
    await this.limits.clear(row.tenantId);
  }
}
