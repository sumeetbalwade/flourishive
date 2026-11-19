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
const PLATFORM_CACHE = 'settings:platform:v2';
interface PlatformEntry {
  value: unknown;
  locked: boolean;
}

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

  private async platformValues(): Promise<Record<string, PlatformEntry>> {
    const cached =
      await this.redis.getJson<Record<string, PlatformEntry>>(PLATFORM_CACHE);
    if (cached) return cached;
    const rows = await runAsSystem(
      async () => await this.prisma.db.platformSetting.findMany(),
    );
    const map = Object.fromEntries(
      rows.map((r) => [r.key, { value: r.value, locked: r.locked }]),
    );
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
    const entry = platform[key];
    // A locked platform value beats every override below it.
    if (entry?.locked) {
      const parsed = def.schema.safeParse(entry.value);
      if (parsed.success) return parsed.data as SettingValueOf<K>;
    }
    const candidates: unknown[] = [
      def.levels.includes('user') ? find('USER', ctx.userId)?.value : undefined,
      def.levels.includes('entity')
        ? find('ENTITY', ctx.entityId)?.value
        : undefined,
      def.levels.includes('tenant')
        ? find('TENANT', ctx.tenantId)?.value
        : undefined,
      entry?.value,
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
      if (SETTINGS[key].levels.length > 0) out[key] = await this.get(key, ctx);
    return out;
  }

  /** Keys this company has set itself (as opposed to inheriting the platform value). */
  async tenantOverrideKeys(tenantId: string): Promise<string[]> {
    return (await this.tenantRows(tenantId))
      .filter((r) => r.scope === 'TENANT' && r.scopeId === tenantId)
      .map((r) => r.key);
  }

  /** Setting keys the platform has locked, so screens can show them read-only. */
  async lockedKeys(): Promise<string[]> {
    return Object.entries(await this.platformValues())
      .filter(([, e]) => e.locked)
      .map(([k]) => k);
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
    if ((await this.platformValues())[key]?.locked)
      throw new BadRequestException(
        `${key} is locked by the platform and cannot be changed`,
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

  /** A platform-only setting (no tenant context), such as the super admin two-step policy. */
  async getPlatform<K extends SettingKey>(key: K): Promise<SettingValueOf<K>> {
    const def = SETTINGS[key];
    const entry = (await this.platformValues())[key];
    if (entry) {
      const parsed = def.schema.safeParse(entry.value);
      if (parsed.success) return parsed.data as SettingValueOf<K>;
    }
    return def.default as SettingValueOf<K>;
  }

  /** Platform defaults. `locked` stops tenants overriding; leaving it out keeps the current lock. */
  async setPlatform(
    key: string,
    value?: unknown,
    locked?: boolean,
  ): Promise<void> {
    if (!isSettingKey(key)) throw new NotFoundException('Unknown setting');
    const def = SETTINGS[key];
    if (locked && def.levels.length === 0)
      throw new BadRequestException('Platform-only settings cannot be locked');
    const current = (await this.platformValues())[key];
    const raw = value === undefined ? (current?.value ?? def.default) : value;
    const parsed = def.schema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    const lock = locked ?? current?.locked ?? false;
    await runAsSystem(async () => {
      await this.prisma.db.platformSetting.upsert({
        where: { key },
        update: { value: parsed.data as never, locked: lock },
        create: { key, value: parsed.data as never, locked: lock },
      });
    });
    await this.redis.del(PLATFORM_CACHE);
  }

  /** Removes a platform default (and its lock), going back to the built-in value. */
  async clearPlatform(key: string): Promise<void> {
    if (!isSettingKey(key)) throw new NotFoundException('Unknown setting');
    await runAsSystem(async () => {
      await this.prisma.db.platformSetting.deleteMany({ where: { key } });
    });
    await this.redis.del(PLATFORM_CACHE);
  }
}
