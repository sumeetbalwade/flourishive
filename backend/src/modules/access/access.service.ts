import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RolePolicyService } from './role-policy.service.js';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  type PermissionCode,
} from './permissions.js';

/** Permission code -> entity ids it applies to, or '*' for every entity. */
export type PermissionMap = Record<string, string[]>;

const CACHE_SECONDS = 60;
const cacheKey = (tenantId: string, userId: string) =>
  `perm:${tenantId}:${userId}`;

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly policies: RolePolicyService,
  ) {}

  /** Syncs the code catalogue into the permissions table (global, idempotent). */
  async syncCatalogue(): Promise<void> {
    for (const code of ALL_PERMISSIONS) {
      await this.prisma.db.permission.upsert({
        where: { code },
        update: { description: PERMISSIONS[code] },
        create: { code, description: PERMISSIONS[code] },
      });
    }
  }

  /** Creates or updates the seeded roles for one tenant (idempotent). */
  async provisionTenantRoles(tenantId: string): Promise<void> {
    await this.syncCatalogue();
    const defaults = new Map(
      await Promise.all(
        SYSTEM_ROLES.map(
          async (d) => [d.key, await this.policies.defaultsFor(d.key)] as const,
        ),
      ),
    );
    await runInTenant(tenantId, async () => {
      for (const def of SYSTEM_ROLES) {
        const role = await this.prisma.db.role.upsert({
          where: { tenantId_key: { tenantId, key: def.key } },
          // Re-provisioning refreshes names and permissions but never a tenant's own policy choices.
          update: { name: def.name, isSystem: true },
          create: {
            tenantId,
            key: def.key,
            name: def.name,
            isSystem: true,
            ...defaults.get(def.key),
          },
        });
        await this.prisma.db.rolePermission.deleteMany({
          where: { roleId: role.id },
        });
        await this.prisma.db.rolePermission.createMany({
          data: def.permissions.map((permissionCode) => ({
            tenantId,
            roleId: role.id,
            permissionCode,
          })),
        });
      }
    });
  }

  async permissionsFor(
    tenantId: string,
    userId: string,
  ): Promise<PermissionMap> {
    const cached = await this.redis.getJson<PermissionMap>(
      cacheKey(tenantId, userId),
    );
    if (cached) return cached;
    const map = await runInTenant(tenantId, async () => {
      const rows = await this.prisma.db.userRole.findMany({
        where: { userId },
        include: { role: { include: { permissions: true } } },
      });
      const out: PermissionMap = {};
      for (const ur of rows) {
        for (const rp of ur.role.permissions) {
          const scopes = (out[rp.permissionCode] ??= []);
          const scope = ur.entityId ?? '*';
          if (!scopes.includes(scope)) scopes.push(scope);
        }
      }
      return out;
    });
    await this.redis.setJson(cacheKey(tenantId, userId), map, CACHE_SECONDS);
    return map;
  }

  /** True if the user holds the permission, optionally for a specific entity. */
  async can(
    tenantId: string,
    userId: string,
    code: PermissionCode,
    entityId?: string,
  ): Promise<boolean> {
    const scopes = (await this.permissionsFor(tenantId, userId))[code];
    if (!scopes) return false;
    return (
      scopes.includes('*') ||
      (entityId !== undefined && scopes.includes(entityId))
    );
  }

  /**
   * Which entities a permission covers for this user: '*' for all, a list of entity ids,
   * or null when they do not hold it at all.
   */
  async entityScope(
    tenantId: string,
    userId: string,
    code: PermissionCode,
  ): Promise<'*' | string[] | null> {
    const scopes = (await this.permissionsFor(tenantId, userId))[code];
    if (!scopes) return null;
    return scopes.includes('*') ? '*' : scopes;
  }

  /** Whether any of the user's roles requires MFA. */
  /** A custom (non-system) role. The platform floor for custom roles is OFF. */
  async createRole(
    tenantId: string,
    input: { name: string; mfaLevel: 'OFF' | 'OPTIONAL' | 'REQUIRED' },
  ): Promise<{ key: string; name: string }> {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 50);
    if (!slug) throw new BadRequestException('Give the role a name');
    const key = `custom_${slug}`;
    await runInTenant(tenantId, async () => {
      if (
        await this.prisma.db.role.findUnique({
          where: { tenantId_key: { tenantId, key } },
        })
      )
        throw new ConflictException('A role with that name already exists');
      const role = await this.prisma.db.role.create({
        data: {
          tenantId,
          key,
          name: input.name,
          isSystem: false,
          mfaLevel: input.mfaLevel,
        },
      });
      await this.prisma.db.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionCode: 'self.read' },
      });
    });
    return { key, name: input.name };
  }

  listRoles(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.role.findMany({
        orderBy: { name: 'asc' },
        include: { permissions: { select: { permissionCode: true } } },
      }),
    );
  }

  /**
   * Assigns a role. The actor must already hold every permission the role carries,
   * so nobody can hand themselves (or a friend) more power than they have.
   */
  async assignRole(
    tenantId: string,
    actorUserId: string,
    input: { userId: string; roleKey: string; entityId?: string },
  ): Promise<void> {
    const actorCodes = new Set(
      Object.keys(await this.permissionsFor(tenantId, actorUserId)),
    );
    await runInTenant(tenantId, async () => {
      const [role, user] = await Promise.all([
        this.prisma.db.role.findUnique({
          where: { tenantId_key: { tenantId, key: input.roleKey } },
          include: { permissions: true },
        }),
        this.prisma.db.user.findUnique({ where: { id: input.userId } }),
      ]);
      if (!role) throw new NotFoundException('Unknown role');
      if (!user) throw new NotFoundException('Unknown user');
      if (role.permissions.some((p) => !actorCodes.has(p.permissionCode))) {
        throw new ForbiddenException(
          'You cannot assign a role with more permissions than you hold',
        );
      }
      if (input.entityId) {
        const entity = await this.prisma.db.entity.findUnique({
          where: { id: input.entityId },
        });
        if (!entity) throw new BadRequestException('Unknown entity');
      }
      const exists = await this.prisma.db.userRole.findFirst({
        where: {
          userId: input.userId,
          roleId: role.id,
          entityId: input.entityId ?? null,
        },
      });
      if (!exists) {
        await this.prisma.db.userRole.create({
          data: {
            tenantId,
            userId: input.userId,
            roleId: role.id,
            entityId: input.entityId ?? null,
          },
        });
      }
    });
    await this.redis.del(cacheKey(tenantId, input.userId));
  }

  async removeRole(
    tenantId: string,
    input: { userId: string; roleKey: string; entityId?: string },
  ): Promise<void> {
    await runInTenant(tenantId, async () => {
      const role = await this.prisma.db.role.findUnique({
        where: { tenantId_key: { tenantId, key: input.roleKey } },
      });
      if (!role) throw new NotFoundException('Unknown role');
      if (role.key === 'tenant_admin') {
        const holders = await this.prisma.db.userRole.count({
          where: { roleId: role.id },
        });
        if (holders <= 1)
          throw new ConflictException(
            'A tenant needs at least one Tenant Admin',
          );
      }
      await this.prisma.db.userRole.deleteMany({
        where: {
          userId: input.userId,
          roleId: role.id,
          entityId: input.entityId ?? null,
        },
      });
    });
    await this.redis.del(cacheKey(tenantId, input.userId));
  }

  /** Provision roles for every tenant; used by the seed and after catalogue changes. */
  async provisionAllTenants(): Promise<number> {
    const tenants = await runAsSystem(
      async () => await this.prisma.db.tenant.findMany(),
    );
    for (const t of tenants) await this.provisionTenantRoles(t.id);
    return tenants.length;
  }
}
