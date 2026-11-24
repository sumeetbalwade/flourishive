import {
  LIMIT_METRICS,
  type LimitMap,
  type LimitMetric,
  type SubscriptionView,
  type UsageNow,
} from '@flourishive/schemas';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';

const cacheKey = (tenantId: string) => `plan:limits:${tenantId}`;
const METRIC_KEYS = LIMIT_METRICS.map((m) => m.key);
const NO_LIMITS: LimitMap = {
  users: null,
  storage_mb: null,
  signatures_month: null,
};

interface Resolved {
  plan: { id: string; key: string; name: string };
  status: SubscriptionView['status'];
  limits: LimitMap;
  overridden: LimitMetric[];
}

const noPlan: Resolved = {
  plan: { id: '', key: 'none', name: 'No plan' },
  status: 'ACTIVE',
  limits: NO_LIMITS,
  overridden: [],
};

/**
 * What a company may use (D-20): the plan's limits, with any per-company override on top.
 * A company without a subscription row has no limits, so nothing breaks before a plan is assigned.
 */
@Injectable()
export class LimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async resolve(tenantId: string): Promise<Resolved> {
    const cached = await this.redis.getJson<Resolved>(cacheKey(tenantId));
    if (cached) return cached;
    const sub = await runInTenant(tenantId, async () =>
      this.prisma.db.subscription.findUnique({
        where: { tenantId },
        include: { plan: { include: { limits: true } } },
      }),
    );
    if (!sub) return noPlan;
    const limits = { ...NO_LIMITS };
    for (const l of sub.plan.limits)
      if (METRIC_KEYS.includes(l.metric as LimitMetric))
        limits[l.metric as LimitMetric] = l.value;
    const over = (sub.limitOverrides ?? {}) as Partial<LimitMap>;
    const overridden: LimitMetric[] = [];
    for (const m of METRIC_KEYS)
      if (m in over && over[m] !== undefined) {
        limits[m] = over[m] ?? null;
        overridden.push(m);
      }
    const out: Resolved = {
      plan: { id: sub.plan.id, key: sub.plan.key, name: sub.plan.name },
      status: sub.status,
      limits,
      overridden,
    };
    await this.redis.setJson(cacheKey(tenantId), out, 60);
    return out;
  }

  /** Live numbers. Counted on demand, so a limit is never enforced against yesterday's snapshot. */
  async usage(tenantId: string): Promise<UsageNow> {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    return runInTenant(tenantId, async () => {
      const db = this.prisma.db;
      const [users, files, signatures] = await Promise.all([
        db.user.count({ where: { status: { not: 'DISABLED' } } }),
        db.file.aggregate({ _sum: { sizeBytes: true } }),
        db.signatureRequest.count({
          where: { createdAt: { gte: monthStart } },
        }),
      ]);
      return {
        users,
        storage_mb:
          Math.round((Number(files._sum.sizeBytes ?? 0) / 1_048_576) * 100) /
          100,
        signatures_month: signatures,
      };
    });
  }

  async view(tenantId: string): Promise<SubscriptionView> {
    const [r, usage] = await Promise.all([
      this.resolve(tenantId),
      this.usage(tenantId),
    ]);
    return {
      plan: r.plan,
      status: r.status,
      limits: r.limits,
      overridden: r.overridden,
      usage,
    };
  }

  /**
   * Refuses (HTTP 402) when adding `adding` more would pass the limit. `adding` for storage is in bytes.
   * The body carries a code the web app turns into an upgrade prompt.
   */
  async assert(
    tenantId: string,
    metric: LimitMetric,
    adding = 1,
  ): Promise<void> {
    const { limits } = await this.resolve(tenantId);
    const limit = limits[metric];
    if (limit === null) return;
    const used = (await this.usage(tenantId))[metric];
    const extra = metric === 'storage_mb' ? adding / 1_048_576 : adding;
    if (used + extra <= limit) return;
    const label = LIMIT_METRICS.find((m) => m.key === metric)!;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'PLAN_LIMIT',
        metric,
        limit,
        used,
        message: `Your plan allows ${limit.toLocaleString('en-IN')} ${label.unit} (${label.label.toLowerCase()}). Upgrade your plan to add more.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  async clear(tenantId: string): Promise<void> {
    await this.redis.del(cacheKey(tenantId));
  }
}
