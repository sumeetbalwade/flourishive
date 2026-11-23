import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { PlatformAuditService } from './platform-audit.service.js';
import {
  OWNER_ROLE_ID,
  PRESET_ROLES,
  isPlatformPermission,
  type PlatformPermission,
} from './platform-permissions.js';

const permsKey = (userId: string) => `platform:perms:${userId}`;
const CACHE_SECONDS = 60;

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isPreset: boolean;
  permissions: string[];
  members: number;
}

/**
 * Platform staff roles (D-55): which codes each role holds, who holds which role, and the rules that
 * stop the platform locking itself out (an Owner always exists, nobody removes their own right to
 * manage roles, only an Owner grants Owner, nobody grants a power they lack).
 */
@Injectable()
export class PlatformRolesService implements OnModuleInit {
  private readonly log = new Logger('PlatformRoles');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: PlatformAuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** Keeps the preset roles' permissions in step with the catalogue (a new code reaches the Owner at once). */
  async onModuleInit(): Promise<void> {
    try {
      await runAsSystem(async () => {
        for (const p of PRESET_ROLES) {
          await this.db.platformRole.upsert({
            where: { key: p.key },
            update: {
              name: p.name,
              description: p.description,
              isPreset: true,
            },
            create: {
              id: p.id,
              key: p.key,
              name: p.name,
              description: p.description,
              isPreset: true,
            },
          });
          const role = await this.db.platformRole.findUniqueOrThrow({
            where: { key: p.key },
          });
          await this.db.platformRolePermission.deleteMany({
            where: { roleId: role.id },
          });
          await this.db.platformRolePermission.createMany({
            data: p.permissions.map((permissionCode) => ({
              roleId: role.id,
              permissionCode,
            })),
          });
        }
      });
    } catch (e) {
      this.log.error(`Could not sync preset roles: ${String(e)}`);
    }
  }

  /** The codes a member of staff holds, cached for a minute. */
  async permissionsOf(userId: string): Promise<Set<string>> {
    const cached = await this.redis
      .getJson<string[]>(permsKey(userId))
      .catch(() => null);
    if (cached) return new Set(cached);
    const user = await runAsSystem(
      async () =>
        await this.db.platformUser.findUnique({
          where: { id: userId },
          select: { role: { select: { permissions: true } } },
        }),
    );
    const codes =
      user?.role.permissions
        .map((p) => p.permissionCode)
        .filter(isPlatformPermission) ?? [];
    await this.redis
      .setJson(permsKey(userId), codes, CACHE_SECONDS)
      .catch(() => undefined);
    return new Set(codes);
  }

  private async forget(userIds: string[]) {
    if (userIds.length) await this.redis.del(...userIds.map(permsKey));
  }

  async roleOf(userId: string) {
    return runAsSystem(
      async () =>
        await this.db.platformUser.findUnique({
          where: { id: userId },
          select: { role: { select: { id: true, key: true, name: true } } },
        }),
    ).then((u) => u?.role ?? null);
  }

  async list(): Promise<RoleView[]> {
    const rows = await runAsSystem(
      async () =>
        await this.db.platformRole.findMany({
          orderBy: [{ isPreset: 'desc' }, { name: 'asc' }],
          include: { permissions: true, _count: { select: { users: true } } },
        }),
    );
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isPreset: r.isPreset,
      permissions: r.permissions.map((p) => p.permissionCode).sort(),
      members: r._count.users,
    }));
  }

  private checkCodes(codes: string[]): PlatformPermission[] {
    const bad = codes.filter((c) => !isPlatformPermission(c));
    if (bad.length)
      throw new BadRequestException(`Unknown permission: ${bad.join(', ')}`);
    return [...new Set(codes)] as PlatformPermission[];
  }

  /** A person can only hand out powers they hold themselves. */
  private async assertCanGrant(actorId: string, codes: string[]) {
    const mine = await this.permissionsOf(actorId);
    const over = codes.filter((c) => !mine.has(c));
    if (over.length)
      throw new ForbiddenException(
        `You cannot give a role powers you do not have yourself (${over.join(', ')})`,
      );
  }

  async create(
    actorId: string,
    input: { name: string; description?: string; permissions: string[] },
    ip?: string,
  ): Promise<RoleView> {
    const codes = this.checkCodes(input.permissions);
    await this.assertCanGrant(actorId, codes);
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 50);
    if (!slug) throw new BadRequestException('Give the role a name');
    const key = `custom_${slug}`;
    const exists = await runAsSystem(
      async () => await this.db.platformRole.findUnique({ where: { key } }),
    );
    if (exists)
      throw new ConflictException('A role with that name already exists');
    const role = await runAsSystem(
      async () =>
        await this.db.platformRole.create({
          data: {
            key,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            isPreset: false,
            permissions: {
              create: codes.map((permissionCode) => ({ permissionCode })),
            },
          },
        }),
    );
    await this.audit.record({
      actorId,
      action: 'platform.role_created',
      entityType: 'platform_roles',
      entityId: role.id,
      meta: { name: role.name, permissions: codes },
      ip,
    });
    return (await this.list()).find((r) => r.id === role.id)!;
  }

  private async customRole(id: string) {
    const role = await runAsSystem(
      async () =>
        await this.db.platformRole.findUnique({
          where: { id },
          include: { users: { select: { id: true } } },
        }),
    );
    if (!role) throw new NotFoundException();
    if (role.isPreset)
      throw new BadRequestException(
        'The built-in roles cannot be edited. Duplicate it to make your own.',
      );
    return role;
  }

  async update(
    actorId: string,
    id: string,
    input: { name?: string; description?: string; permissions?: string[] },
    ip?: string,
  ): Promise<void> {
    const role = await this.customRole(id);
    const codes = input.permissions ? this.checkCodes(input.permissions) : null;
    if (codes) {
      await this.assertCanGrant(actorId, codes);
      // Nobody removes their own right to manage roles.
      const actor = role.users.some((u) => u.id === actorId);
      if (actor && !codes.includes('roles.manage'))
        throw new BadRequestException(
          'You hold this role, so you cannot remove your own right to manage roles',
        );
    }
    await runAsSystem(async () => {
      await this.db.platformRole.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description.trim() || null }
            : {}),
        },
      });
      if (codes) {
        await this.db.platformRolePermission.deleteMany({
          where: { roleId: id },
        });
        await this.db.platformRolePermission.createMany({
          data: codes.map((permissionCode) => ({ roleId: id, permissionCode })),
        });
      }
    });
    await this.forget(role.users.map((u) => u.id));
    await this.audit.record({
      actorId,
      action: 'platform.role_changed',
      entityType: 'platform_roles',
      entityId: id,
      meta: { name: role.name, ...(codes ? { permissions: codes } : {}) },
      ip,
    });
  }

  async remove(actorId: string, id: string, ip?: string): Promise<void> {
    const role = await this.customRole(id);
    if (role.users.length)
      throw new ConflictException(
        'People still hold this role. Move them to another role first.',
      );
    await runAsSystem(
      async () => await this.db.platformRole.delete({ where: { id } }),
    );
    await this.audit.record({
      actorId,
      action: 'platform.role_deleted',
      entityType: 'platform_roles',
      entityId: id,
      meta: { name: role.name },
      ip,
    });
  }

  /** Active Owners right now (an invited or suspended Owner does not count). */
  async activeOwners(): Promise<number> {
    return runAsSystem(
      async () =>
        await this.db.platformUser.count({
          where: { roleId: OWNER_ROLE_ID, status: 'ACTIVE' },
        }),
    );
  }

  /** Refuses a change that would leave the platform with no active Owner. */
  async assertOwnerRemains(
    userId: string,
    change: 'role' | 'disable',
  ): Promise<void> {
    const user = await runAsSystem(
      async () =>
        await this.db.platformUser.findUnique({ where: { id: userId } }),
    );
    if (user?.roleId !== OWNER_ROLE_ID || user.status !== 'ACTIVE') return;
    if ((await this.activeOwners()) <= 1)
      throw new BadRequestException(
        change === 'role'
          ? 'This is the last active Owner. Make someone else an Owner first.'
          : 'This is the last active Owner and cannot be suspended.',
      );
  }

  async assign(
    actorId: string,
    userId: string,
    roleId: string,
    ip?: string,
  ): Promise<void> {
    const [role, target, actorRole] = await Promise.all([
      runAsSystem(
        async () =>
          await this.db.platformRole.findUnique({
            where: { id: roleId },
            include: { permissions: true },
          }),
      ),
      runAsSystem(
        async () =>
          await this.db.platformUser.findUnique({ where: { id: userId } }),
      ),
      this.roleOf(actorId),
    ]);
    if (!role || !target) throw new NotFoundException();
    // Only an Owner can grant Owner, and take it away.
    if (
      (roleId === OWNER_ROLE_ID || target.roleId === OWNER_ROLE_ID) &&
      actorRole?.id !== OWNER_ROLE_ID
    )
      throw new ForbiddenException(
        'Only an Owner can grant or change an Owner',
      );
    await this.assertCanGrant(
      actorId,
      role.permissions.map((p) => p.permissionCode),
    );
    if (
      userId === actorId &&
      !role.permissions.some((p) => p.permissionCode === 'roles.manage')
    )
      throw new BadRequestException(
        'You cannot move yourself to a role that cannot manage roles',
      );
    if (roleId !== target.roleId) await this.assertOwnerRemains(userId, 'role');
    await runAsSystem(
      async () =>
        await this.db.platformUser.update({
          where: { id: userId },
          data: { roleId },
        }),
    );
    await this.forget([userId]);
    await this.audit.record({
      actorId,
      action: 'platform.staff_role_changed',
      entityType: 'platform_users',
      entityId: userId,
      meta: { role: role.name },
      ip,
    });
  }
}
