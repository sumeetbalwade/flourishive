import { createTenantBody } from '@flourishive/schemas';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../identity/auth.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { SETTINGS, shapeOf, type SettingKey } from '../settings/registry.js';
import {
  RolePolicyService,
  type PolicyPatch,
} from '../access/role-policy.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  PlatformAuditService,
  PLATFORM_TENANT_SLUG,
} from './platform-audit.service.js';
import { CompanyDnsService, type DnsResult } from './company-dns.service.js';
import { PlatformAuthService } from './platform-auth.service.js';

export const suspendedKey = (tenantId: string) =>
  `tenant:suspended:${tenantId}`;

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly policies: RolePolicyService,
    private readonly redis: RedisService,
    private readonly audit: PlatformAuditService,
    private readonly tenantAudit: AuditService,
    private readonly platformAuth: PlatformAuthService,
    private readonly dns: CompanyDnsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async listTenants() {
    const rows = await runAsSystem(
      async () =>
        await this.db.tenant.findMany({
          where: { slug: { not: PLATFORM_TENANT_SLUG } },
          orderBy: { createdAt: 'asc' },
          include: {
            _count: {
              select: { users: true, engagements: true, entities: true },
            },
          },
        }),
    );
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      counts: t._count,
    }));
  }

  async getTenant(id: string) {
    const t = await runAsSystem(
      async () =>
        await this.db.tenant.findUnique({
          where: { id },
          include: {
            entities: true,
            _count: { select: { users: true, engagements: true } },
          },
        }),
    );
    if (!t || t.slug === PLATFORM_TENANT_SLUG) throw new NotFoundException();
    const [chain, settings] = await Promise.all([
      this.tenantAudit.verifyChain(id),
      runInTenant(
        id,
        async () =>
          await this.db.settingValue.findMany({ where: { scope: 'TENANT' } }),
      ),
    ]);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      entities: t.entities.map((e) => ({
        id: e.id,
        name: e.name,
        legalName: e.legalName,
      })),
      counts: t._count,
      auditChain: chain,
      settingOverrides: Object.fromEntries(
        settings.map((s) => [s.key, s.value]),
      ),
    };
  }

  /** Creates the tenant, its first company, the seeded roles and the first Tenant Admin (invited by email). */
  async createTenant(
    actorId: string,
    body: z.infer<typeof createTenantBody>,
    ip?: string,
  ) {
    // The product's own name is kept for the platform, whatever it is called today.
    const brandSlug = this.config.APP_NAME.toLowerCase().replace(
      /[^a-z0-9]+/g,
      '-',
    );
    if (
      body.slug === brandSlug ||
      body.slug === this.config.APP_DOMAIN?.split('.')[0]
    )
      throw new BadRequestException('That name is reserved');
    const { tenant, userId } = await runAsSystem(async () => {
      try {
        return await this.db.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: { slug: body.slug, name: body.name },
          });
          await tx.entity.create({
            data: {
              tenantId: tenant.id,
              name: body.companyName,
              legalName: body.legalName,
            },
          });
          const user = await tx.user.create({
            data: {
              tenantId: tenant.id,
              email: body.adminEmail,
              status: 'INVITED',
            },
          });
          return { tenant, userId: user.id };
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002')
          throw new ConflictException('That company code is already taken');
        throw e;
      }
    });
    await this.access.provisionTenantRoles(tenant.id);
    await runInTenant(tenant.id, async () => {
      const role = await this.db.role.findUnique({
        where: { tenantId_key: { tenantId: tenant.id, key: 'tenant_admin' } },
      });
      await this.db.userRole.create({
        data: { tenantId: tenant.id, userId, roleId: role!.id },
      });
    });
    await this.auth.sendPasswordLink(
      tenant.id,
      userId,
      body.adminEmail,
      'invite',
    );
    await this.audit.record({
      actorId,
      tenantId: tenant.id,
      action: 'platform.tenant_created',
      entityType: 'tenants',
      entityId: tenant.id,
      meta: { slug: tenant.slug },
      ip,
    });
    // A DNS problem must not undo the company. The result says what happened; syncDns() retries.
    let dns: DnsResult | 'failed' = 'off';
    try {
      dns = await this.dns.ensure(tenant.slug);
    } catch (e) {
      dns = 'failed';
      await this.audit.record({
        actorId,
        tenantId: tenant.id,
        action: 'platform.tenant_dns_failed',
        entityType: 'tenants',
        entityId: tenant.id,
        meta: { error: e instanceof Error ? e.message : String(e) },
        ip,
      });
    }
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      adminEmail: body.adminEmail,
      dns,
    };
  }

  /** (Re)creates the company's address in Cloudflare, for example after a failure. */
  async syncDns(actorId: string, id: string, ip?: string) {
    const t = await runAsSystem(
      async () => await this.db.tenant.findUnique({ where: { id } }),
    );
    if (!t || t.slug === PLATFORM_TENANT_SLUG) throw new NotFoundException();
    let dns: DnsResult;
    try {
      dns = await this.dns.ensure(t.slug);
    } catch (e) {
      throw new BadGatewayException(
        e instanceof Error ? e.message : 'Cloudflare could not be reached',
      );
    }
    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'platform.tenant_dns_synced',
      entityType: 'tenants',
      entityId: id,
      meta: { result: dns },
      ip,
    });
    return { dns, host: this.dns.hostFor(t.slug) };
  }

  async updateTenant(
    actorId: string,
    id: string,
    body: { name?: string; status?: 'ACTIVE' | 'SUSPENDED' },
    ip?: string,
  ) {
    const existing = await runAsSystem(
      async () => await this.db.tenant.findUnique({ where: { id } }),
    );
    if (!existing || existing.slug === PLATFORM_TENANT_SLUG)
      throw new NotFoundException();
    await runAsSystem(async () => {
      await this.db.tenant.update({ where: { id }, data: body });
    });
    if (body.status === 'SUSPENDED')
      await this.redis.client.set(suspendedKey(id), '1');
    if (body.status === 'ACTIVE') await this.redis.del(suspendedKey(id));
    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'platform.tenant_updated',
      entityType: 'tenants',
      entityId: id,
      meta: body,
      ip,
    });
  }

  listUsers() {
    return runAsSystem(async () =>
      this.db.platformUser.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          status: true,
          mfaEnabledAt: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
    );
  }

  inviteUser(actorId: string, email: string) {
    return this.platformAuth.invite(email, actorId);
  }

  async setUserStatus(
    actorId: string,
    id: string,
    status: 'ACTIVE' | 'DISABLED',
  ) {
    if (id === actorId)
      throw new BadRequestException('You cannot change your own status');
    const user = await runAsSystem(
      async () => await this.db.platformUser.findUnique({ where: { id } }),
    );
    if (!user) throw new NotFoundException();
    if (user.status === 'INVITED')
      throw new BadRequestException('They have not accepted the invite yet');
    await runAsSystem(async () => {
      await this.db.platformUser.update({ where: { id }, data: { status } });
      if (status === 'DISABLED')
        await this.db.platformSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
    });
    await this.audit.record({
      actorId,
      action: `platform.user_${status.toLowerCase()}`,
      entityType: 'platform_users',
      entityId: id,
    });
  }

  async platformSettings() {
    const rows = await runAsSystem(
      async () => await this.db.platformSetting.findMany(),
    );
    const stored = Object.fromEntries(rows.map((r) => [r.key, r]));
    return Object.entries(SETTINGS).map(([key, d]) => ({
      key,
      description: d.description,
      label: d.label,
      group: d.group,
      ...shapeOf(key as SettingKey),
      levels: d.levels,
      default: this.settings.defaultOf(key as SettingKey),
      platformValue: stored[key]?.value ?? null,
      locked: stored[key]?.locked ?? false,
    }));
  }

  async setPlatformSetting(
    actorId: string,
    key: string,
    value: unknown,
    locked?: boolean,
  ) {
    await this.settings.setPlatform(key, value, locked);
    await this.audit.record({
      actorId,
      action: 'platform.setting_changed',
      entityType: 'platform_settings',
      entityId: key,
      meta: { locked },
    });
  }

  async clearPlatformSetting(actorId: string, key: string) {
    await this.settings.clearPlatform(key);
    await this.audit.record({
      actorId,
      action: 'platform.setting_cleared',
      entityType: 'platform_settings',
      entityId: key,
    });
  }

  platformPolicies() {
    return this.policies.platformPolicies();
  }

  async setPlatformPolicy(
    actorId: string,
    roleKey: string,
    patch: PolicyPatch,
  ) {
    await this.policies.setPlatformPolicy(roleKey, patch);
    await this.audit.record({
      actorId,
      action: 'platform.role_policy_changed',
      entityType: 'role_policies',
      entityId: roleKey,
      meta: patch as Record<string, unknown>,
    });
  }

  async setTenantSetting(
    actorId: string,
    tenantId: string,
    key: string,
    value: unknown,
  ) {
    await this.getTenant(tenantId); // 404 for unknown tenants
    await this.settings.set(
      { tenantId, updatedBy: actorId },
      'tenant',
      key,
      value,
    );
    await this.audit.record({
      actorId,
      tenantId,
      action: 'platform.tenant_setting_changed',
      entityType: 'settings',
      entityId: key,
    });
  }

  async clearTenantSetting(actorId: string, tenantId: string, key: string) {
    await this.getTenant(tenantId);
    await this.settings.clear({ tenantId }, 'tenant', key);
    await this.audit.record({
      actorId,
      tenantId,
      action: 'platform.tenant_setting_cleared',
      entityType: 'settings',
      entityId: key,
    });
  }
}
