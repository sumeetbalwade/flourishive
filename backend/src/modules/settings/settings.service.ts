import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import {
  SETTINGS,
  isSettingKey,
  type SettingKey,
  type SettingLevel,
  type SettingValueOf,
} from './registry.js';

export interface SettingContext {
  tenantId: string;
  entityId?: string;
  userId?: string;
}

interface Row {
  scope: 'TENANT' | 'ENTITY' | 'USER';
  scopeId: string;
  key: string;
  value: unknown;
}

const TTL = 300;
const tenantCache = (tenantId: string) => `settings:t:${tenantId}`;
const PLATFORM_CACHE = 'settings:platform';

/**
 * Resolves user → entity → tenant → plan → platform → built-in default.
 * (The plan level arrives with plans in Phase 3.) A stored value that no longer
 * passes its schema is ignored rather than breaking the app.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async tenantRows(tenantId: string): Promise<Row[]> {
    const cached = await this.redis.getJson<Row[]>(tenantCache(tenantId));
    if (cached) return cached;
    const rows = await runInTenant(
      tenantId,
      async () => await this.prisma.db.settingValue.findMany(),
    );
    const slim = rows.map((r) => ({
      scope: r.scope,
      scopeId: r.scopeId,
      key: r.key,
      value: r.value,
    }));
    await this.redis.setJson(tenantCache(tenantId), slim, TTL);
    return slim;
  }

  private async platformValues(): Promise<Record<string, unknown>> {
    const cached =
      await this.redis.getJson<Record<string, unknown>>(PLATFORM_CACHE);
    if (cached) return cached;
    const rows = await runAsSystem(
      async () => await this.prisma.db.platformSetting.findMany(),
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    await this.redis.setJson(PLATFORM_CACHE, map, TTL);
    return map;
  }

  async get<K extends SettingKey>(
    key: K,
    ctx: SettingContext,
  ): Promise<SettingValueOf<K>> {
    const def = SETTINGS[key];
    const rows = await this.tenantRows(ctx.tenantId);
    const find = (scope: Row['scope'], scopeId?: string) =>
      scopeId
        ? rows.find(
            (r) => r.scope === scope && r.scopeId === scopeId && r.key === key,
          )
        : undefined;
    const platform = await this.platformValues();
    const candidates: unknown[] = [
      def.levels.includes('user') ? find('USER', ctx.userId)?.value : undefined,
      def.levels.includes('entity')
        ? find('ENTITY', ctx.entityId)?.value
        : undefined,
      def.levels.includes('tenant')
        ? find('TENANT', ctx.tenantId)?.value
        : undefined,
      platform[key],
    ];
    for (const c of candidates) {
      if (c === undefined) continue;
      const parsed = def.schema.safeParse(c);
      if (parsed.success) return parsed.data as SettingValueOf<K>;
    }
    return def.default as SettingValueOf<K>;
  }

  /** Every setting resolved for the caller, with where each value came from. */
  async resolveAll(ctx: SettingContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SETTINGS) as SettingKey[])
      out[key] = await this.get(key, ctx);
    return out;
  }

  async set(
    ctx: SettingContext & { updatedBy: string },
    level: SettingLevel,
    key: string,
    value: unknown,
    scopeId?: string,
  ): Promise<void> {
    if (!isSettingKey(key)) throw new NotFoundException('Unknown setting');
    const def = SETTINGS[key];
    if (!def.levels.includes(level))
      throw new BadRequestException(
        `${key} cannot be set at the ${level} level`,
      );
    const parsed = def.schema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));

    const scope = level.toUpperCase() as Row['scope'];
    const id =
      level === 'tenant'
        ? ctx.tenantId
        : level === 'user'
          ? ctx.userId
          : scopeId;
    if (!id) throw new BadRequestException('Missing scope id');
    await runInTenant(ctx.tenantId, async () => {
      if (level === 'entity') {
        const entity = await this.prisma.db.entity.findUnique({
          where: { id },
        });
        if (!entity) throw new BadRequestException('Unknown entity');
      }
      await this.prisma.db.settingValue.upsert({
        where: { scope_scopeId_key: { scope, scopeId: id, key } },
        update: { value: parsed.data as never, updatedBy: ctx.updatedBy },
        create: {
          tenantId: ctx.tenantId,
          scope,
          scopeId: id,
          key,
          value: parsed.data as never,
          updatedBy: ctx.updatedBy,
        },
      });
    });
    await this.redis.del(tenantCache(ctx.tenantId));
  }

  async clear(
    ctx: SettingContext,
    level: SettingLevel,
    key: string,
    scopeId?: string,
  ): Promise<void> {
    if (!isSettingKey(key)) throw new NotFoundException('Unknown setting');
    const id =
      level === 'tenant'
        ? ctx.tenantId
        : level === 'user'
          ? ctx.userId
          : scopeId;
    if (!id) throw new BadRequestException('Missing scope id');
    await runInTenant(ctx.tenantId, async () => {
      await this.prisma.db.settingValue.deleteMany({
        where: { scope: level.toUpperCase() as Row['scope'], scopeId: id, key },
      });
    });
    await this.redis.del(tenantCache(ctx.tenantId));
  }

  /** Platform defaults: used by the super admin console (next PR) and tests. */
  async setPlatform(key: string, value: unknown): Promise<void> {
    if (!isSettingKey(key)) throw new NotFoundException('Unknown setting');
    const parsed = SETTINGS[key].schema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    await runAsSystem(async () => {
      await this.prisma.db.platformSetting.upsert({
        where: { key },
        update: { value: parsed.data as never },
        create: { key, value: parsed.data as never },
      });
    });
    await this.redis.del(PLATFORM_CACHE);
  }
}
