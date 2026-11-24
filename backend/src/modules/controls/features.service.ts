import { FEATURES, type FeatureKey } from '@flourishive/schemas';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';

const key = (tenantId: string) => `features:off:${tenantId}`;

/** Which modules each company has switched off by the super admin (D-70). A module is on unless a row says off. */
@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** The keys switched off for this company. Cached for a minute and cleared on every change. */
  async disabled(tenantId: string): Promise<string[]> {
    const cached = await this.redis.getJson<string[]>(key(tenantId));
    if (cached) return cached;
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantFeature.findMany({ where: { enabled: false } }),
    );
    const off = rows.map((r) => r.feature);
    await this.redis.setJson(key(tenantId), off, 60);
    return off;
  }

  async enabled(tenantId: string, feature: FeatureKey): Promise<boolean> {
    return !(await this.disabled(tenantId)).includes(feature);
  }

  async assert(tenantId: string, feature: FeatureKey): Promise<void> {
    if (!(await this.enabled(tenantId, feature)))
      throw new ForbiddenException(
        'This feature is switched off for your company. Ask your administrator to contact support.',
      );
  }

  async state(tenantId: string) {
    const off = new Set(await this.disabled(tenantId));
    return {
      features: FEATURES.map((f) => ({
        key: f.key as string,
        label: f.label as string,
        hint: f.hint as string,
        enabled: !off.has(f.key),
      })),
    };
  }

  async set(
    tenantId: string,
    feature: FeatureKey,
    enabled: boolean,
    by: string | null,
  ): Promise<void> {
    await runInTenant(tenantId, async () =>
      this.prisma.db.tenantFeature.upsert({
        where: { tenantId_feature: { tenantId, feature } },
        update: { enabled, updatedBy: by },
        create: { tenantId, feature, enabled, updatedBy: by },
      }),
    );
    await this.redis.del(key(tenantId));
  }
}
