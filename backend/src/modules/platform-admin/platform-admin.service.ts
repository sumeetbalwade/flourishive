import { createTenantBody } from '@flourishive/schemas';
import {
  BadRequestException,
  ConflictException,
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
import { SETTINGS } from '../settings/registry.js';
import {
  RolePolicyService,
  type PolicyPatch,
} from '../access/role-policy.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  PlatformAuditService,
  PLATFORM_TENANT_SLUG,
} from './platform-audit.service.js';
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
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      adminEmail: body.adminEmail,
    };
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
      levels: d.levels,
      default: d.default,
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
