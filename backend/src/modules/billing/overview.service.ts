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
    const [subs, failed] = await Promise.all([
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
    ]);
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
      failures: failed.map((f) => ({
        id: f.id,
        type: f.type,
        error: f.error ?? '',
        at: f.createdAt.toISOString(),
      })),
    };
  }
}
