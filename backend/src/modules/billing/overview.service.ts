import { LIMIT_METRICS, type BillingOverview } from '@flourishive/schemas';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { LimitsService } from './limits.service.js';

/** What the super admin sees on the billing dashboard (D-20). */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: LimitsService,
  ) {}

  async overview(): Promise<BillingOverview> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [subs, failed, hookFails] = await Promise.all([
      runAsSystem(async () =>
        this.prisma.db.subscription.findMany({
          include: { plan: true, tenant: true },
        }),
      ),
      runAsSystem(async () =>
        this.prisma.db.billingEvent.findMany({
          where: { processedAt: null, error: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ),
      runAsSystem(async () =>
        this.prisma.db.webhookDelivery.findMany({
          where: { status: 'FAILED', createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 500,
          include: {
            subscription: { select: { url: true } },
            tenant: { select: { name: true } },
          },
        }),
      ),
    ]);
    const byEndpoint = new Map<
      string,
      {
        tenantId: string;
        name: string;
        host: string;
        failed: number;
        lastError: string;
      }
    >();
    for (const f of hookFails) {
      const host = (() => {
        try {
          return new URL(f.subscription.url).host;
        } catch {
          return f.subscription.url;
        }
      })();
      const k = `${f.tenantId}|${host}`;
      const cur = byEndpoint.get(k);
      if (cur) cur.failed += 1;
      else
        byEndpoint.set(k, {
          tenantId: f.tenantId,
          name: f.tenant.name,
          host,
          failed: 1,
          lastError: f.lastError ?? '',
        });
    }
    // The platform's own company is not a customer.
    const real = subs.filter((s) => !s.tenant.slug.startsWith('_'));
    const nearLimit: BillingOverview['nearLimit'] = [];
    for (const s of real) {
      const v = await this.limits.view(s.tenantId);
      for (const m of LIMIT_METRICS) {
        const limit = v.limits[m.key];
        if (limit === null) continue;
        const used = v.usage[m.key];
        const percent = limit === 0 ? 100 : Math.round((used / limit) * 100);
        if (percent >= 80)
          nearLimit.push({
            tenantId: s.tenantId,
            name: s.tenant.name,
            plan: s.plan.name,
            metric: m.key,
            used,
            limit,
            percent,
          });
      }
    }
    nearLimit.sort((a, b) => b.percent - a.percent);
    const paying = real.filter(
      (s) => s.gatewaySubscriptionId && !s.pendingPlanId,
    );
    return {
      totals: {
        companies: real.length,
        paying: paying.length,
        pastDue: real.filter((s) => s.status === 'PAST_DUE').length,
        readOnly: real.filter((s) => s.status === 'READ_ONLY').length,
        suspended: real.filter((s) => s.status === 'SUSPENDED').length,
        mrr: paying.reduce(
          (sum, s) =>
            sum +
            (s.billingInterval === 'YEARLY'
              ? Math.round(s.plan.priceYearly / 12)
              : s.plan.priceMonthly),
          0,
        ),
      },
      nearLimit: nearLimit.slice(0, 50),
      deliveryFailures: [...byEndpoint.values()]
        .sort((a, b) => b.failed - a.failed)
        .slice(0, 20),
      failures: failed.map((f) => ({
        id: f.id,
        type: f.type,
        error: f.error ?? '',
        at: f.createdAt.toISOString(),
      })),
    };
  }
}
