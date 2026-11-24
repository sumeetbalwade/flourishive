import {
  LIMIT_METRICS,
  type AssignPlanBody,
  type LimitMap,
  type PlanBody,
  type PlanView,
} from '@flourishive/schemas';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { LimitsService } from './limits.service.js';

type PlanRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  isPublic: boolean;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  limits: { metric: string; value: number | null }[];
  _count: { subscriptions: number };
};

const toView = (p: PlanRow): PlanView => {
  const limits: LimitMap = {
    users: null,
    storage_mb: null,
    signatures_month: null,
  };
  for (const l of p.limits)
    if (l.metric in limits) limits[l.metric as keyof LimitMap] = l.value;
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    priceMonthly: p.priceMonthly,
    priceYearly: p.priceYearly,
    currency: p.currency,
    isPublic: p.isPublic,
    isDefault: p.isDefault,
    active: p.active,
    sortOrder: p.sortOrder,
    limits,
    companies: p._count.subscriptions,
  };
};

const include = {
  limits: true,
  _count: { select: { subscriptions: true } },
} as const;

/** The plans the super admin sells, and which company is on which plan (D-20). */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: LimitsService,
  ) {}

  async list(): Promise<PlanView[]> {
    const rows = await runAsSystem(async () =>
      this.prisma.db.plan.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include,
      }),
    );
    return rows.map(toView);
  }

  /** What a company may choose from: public, active plans. */
  async catalogue(): Promise<PlanView[]> {
    return (await this.list()).filter((p) => p.isPublic && p.active);
  }

  async create(b: PlanBody): Promise<PlanView> {
    try {
      const id = await runAsSystem(async () =>
        this.prisma.db.$transaction(async (tx) => {
          if (b.isDefault)
            await tx.plan.updateMany({ data: { isDefault: false } });
          const p = await tx.plan.create({
            data: {
              key: b.key,
              name: b.name,
              description: b.description,
              priceMonthly: b.priceMonthly,
              priceYearly: b.priceYearly,
              isPublic: b.isPublic,
              isDefault: b.isDefault,
              active: b.active,
              sortOrder: b.sortOrder,
              limits: {
                create: LIMIT_METRICS.map((m) => ({
                  metric: m.key,
                  value: b.limits[m.key],
                })),
              },
            },
          });
          return p.id;
        }),
      );
      return this.get(id);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A plan with that key already exists');
      throw e;
    }
  }

  async get(id: string): Promise<PlanView> {
    const p = await runAsSystem(async () =>
      this.prisma.db.plan.findUnique({ where: { id }, include }),
    );
    if (!p) throw new NotFoundException('That plan does not exist');
    return toView(p);
  }

  async update(id: string, b: PlanBody): Promise<PlanView> {
    const before = await this.get(id);
    if (before.isDefault && !b.isDefault)
      throw new BadRequestException(
        'Make another plan the default first, so new companies always have a plan',
      );
    if (before.key !== b.key && before.companies > 0)
      throw new BadRequestException(
        'The key cannot change while companies are on this plan',
      );
    await runAsSystem(async () =>
      this.prisma.db.$transaction(async (tx) => {
        if (b.isDefault)
          await tx.plan.updateMany({
            where: { id: { not: id } },
            data: { isDefault: false },
          });
        await tx.plan.update({
          where: { id },
          data: {
            key: b.key,
            name: b.name,
            description: b.description,
            priceMonthly: b.priceMonthly,
            priceYearly: b.priceYearly,
            isPublic: b.isPublic,
            isDefault: b.isDefault,
            active: b.active,
            sortOrder: b.sortOrder,
          },
        });
        for (const m of LIMIT_METRICS)
          await tx.planLimit.upsert({
            where: { planId_metric: { planId: id, metric: m.key } },
            update: { value: b.limits[m.key] },
            create: { planId: id, metric: m.key, value: b.limits[m.key] },
          });
      }),
    );
    await this.clearCompanies(id);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const p = await this.get(id);
    if (p.isDefault)
      throw new BadRequestException('The default plan cannot be removed');
    if (p.companies > 0)
      throw new BadRequestException('Move the companies off this plan first');
    await runAsSystem(async () =>
      this.prisma.db.plan.delete({ where: { id } }),
    );
  }

  async defaultPlanId(): Promise<string | null> {
    const p = await runAsSystem(async () =>
      this.prisma.db.plan.findFirst({
        where: { isDefault: true, active: true },
      }),
    );
    return p?.id ?? null;
  }

  /** Puts a company on a plan (or changes its overrides or status). */
  async assign(
    tenantId: string,
    b: AssignPlanBody,
    by: string | null,
  ): Promise<void> {
    await this.get(b.planId);
    const overrides = b.limitOverrides
      ? Object.fromEntries(
          Object.entries(b.limitOverrides).filter(([, v]) => v !== undefined),
        )
      : null;
    const json =
      overrides && Object.keys(overrides).length ? overrides : undefined;
    await runAsSystem(async () =>
      this.prisma.db.subscription.upsert({
        where: { tenantId },
        update: {
          planId: b.planId,
          status: b.status,
          limitOverrides: json ?? Prisma.DbNull,
          updatedBy: by,
        },
        create: {
          tenantId,
          planId: b.planId,
          status: b.status,
          limitOverrides: json,
          updatedBy: by,
        },
      }),
    );
    await this.limits.clear(tenantId);
  }

  private async clearCompanies(planId: string): Promise<void> {
    const subs = await runAsSystem(async () =>
      this.prisma.db.subscription.findMany({
        where: { planId },
        select: { tenantId: true },
      }),
    );
    for (const s of subs) await this.limits.clear(s.tenantId);
  }
}
