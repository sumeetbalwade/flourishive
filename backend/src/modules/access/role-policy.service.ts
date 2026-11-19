import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { SYSTEM_ROLES, type MfaLevelName } from './permissions.js';

export const LEVEL_RANK: Record<MfaLevelName, number> = {
  OFF: 0,
  OPTIONAL: 1,
  REQUIRED: 2,
};
export const highest = (levels: MfaLevelName[]): MfaLevelName =>
  levels.reduce<MfaLevelName>(
    (a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a),
    'OFF',
  );

export interface RolePolicy {
  mfaLevel: MfaLevelName;
  recoveryEmail: boolean;
  recoveryCodes: boolean;
}
export interface PlatformRolePolicyView extends RolePolicy {
  roleKey: string;
  name: string;
  mfaFloor: MfaLevelName;
}
export interface TenantRolePolicyView extends RolePolicy {
  roleKey: string;
  name: string;
  isSystem: boolean;
  /** Lowest level this tenant may choose for the role. */
  mfaFloor: MfaLevelName;
}

export interface PolicyPatch {
  mfaLevel?: MfaLevelName;
  mfaFloor?: MfaLevelName;
  recoveryEmail?: boolean;
  recoveryCodes?: boolean;
}

/**
 * Two-step and recovery policy per role. The platform sets a default and a floor for
 * each system role; a tenant can raise a role above the floor but never below it.
 */
@Injectable()
export class RolePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Platform policy for every system role (stored rows over built-in defaults). */
  async platformPolicies(): Promise<PlatformRolePolicyView[]> {
    const rows = await runAsSystem(
      async () => await this.prisma.db.platformRolePolicy.findMany(),
    );
    const byKey = new Map(rows.map((r) => [r.roleKey, r]));
    return SYSTEM_ROLES.map((d) => {
      const r = byKey.get(d.key);
      return {
        roleKey: d.key,
        name: d.name,
        mfaLevel: r?.mfaLevel ?? d.mfaLevel,
        mfaFloor: r?.mfaFloor ?? d.mfaFloor,
        recoveryEmail: r?.recoveryEmail ?? true,
        recoveryCodes: r?.recoveryCodes ?? true,
      };
    });
  }

  async floorFor(roleKey: string): Promise<MfaLevelName> {
    const all = await this.platformPolicies();
    return all.find((p) => p.roleKey === roleKey)?.mfaFloor ?? 'OFF';
  }

  async setPlatformPolicy(roleKey: string, patch: PolicyPatch): Promise<void> {
    const current = (await this.platformPolicies()).find(
      (p) => p.roleKey === roleKey,
    );
    if (!current) throw new NotFoundException('Unknown system role');
    const next = { ...current, ...patch };
    if (LEVEL_RANK[next.mfaLevel] < LEVEL_RANK[next.mfaFloor])
      throw new BadRequestException(
        'The default level cannot be below the floor',
      );
    await runAsSystem(async () => {
      await this.prisma.db.platformRolePolicy.upsert({
        where: { roleKey },
        update: {
          mfaLevel: next.mfaLevel,
          mfaFloor: next.mfaFloor,
          recoveryEmail: next.recoveryEmail,
          recoveryCodes: next.recoveryCodes,
        },
        create: {
          roleKey,
          mfaLevel: next.mfaLevel,
          mfaFloor: next.mfaFloor,
          recoveryEmail: next.recoveryEmail,
          recoveryCodes: next.recoveryCodes,
        },
      });
      // Raising the floor lifts any tenant that was below it.
      if (next.mfaFloor === 'REQUIRED')
        await this.prisma.db.role.updateMany({
          where: { key: roleKey, mfaLevel: { not: 'REQUIRED' } },
          data: { mfaLevel: 'REQUIRED' },
        });
      else if (next.mfaFloor === 'OPTIONAL')
        await this.prisma.db.role.updateMany({
          where: { key: roleKey, mfaLevel: 'OFF' },
          data: { mfaLevel: 'OPTIONAL' },
        });
    });
  }

  /** What a tenant starts with for each system role. */
  async defaultsFor(roleKey: string): Promise<RolePolicy> {
    const p = (await this.platformPolicies()).find(
      (x) => x.roleKey === roleKey,
    );
    return {
      mfaLevel: p?.mfaLevel ?? 'OPTIONAL',
      recoveryEmail: p?.recoveryEmail ?? true,
      recoveryCodes: p?.recoveryCodes ?? true,
    };
  }

  async tenantPolicies(tenantId: string): Promise<TenantRolePolicyView[]> {
    const [roles, platform] = await Promise.all([
      runInTenant(
        tenantId,
        async () =>
          await this.prisma.db.role.findMany({ orderBy: { name: 'asc' } }),
      ),
      this.platformPolicies(),
    ]);
    const floors = new Map(platform.map((p) => [p.roleKey, p.mfaFloor]));
    return roles.map((r) => ({
      roleKey: r.key,
      name: r.name,
      isSystem: r.isSystem,
      mfaLevel: r.mfaLevel,
      mfaFloor: floors.get(r.key) ?? 'OFF',
      recoveryEmail: r.recoveryEmail,
      recoveryCodes: r.recoveryCodes,
    }));
  }

  async setTenantPolicy(
    tenantId: string,
    roleKey: string,
    patch: Omit<PolicyPatch, 'mfaFloor'>,
  ): Promise<void> {
    const floor = await this.floorFor(roleKey);
    if (patch.mfaLevel && LEVEL_RANK[patch.mfaLevel] < LEVEL_RANK[floor])
      throw new BadRequestException(
        `Two-step for this role cannot be lower than ${floor.toLowerCase()}`,
      );
    await runInTenant(tenantId, async () => {
      const role = await this.prisma.db.role.findUnique({
        where: { tenantId_key: { tenantId, key: roleKey } },
      });
      if (!role) throw new NotFoundException('Unknown role');
      await this.prisma.db.role.update({
        where: { id: role.id },
        data: patch,
      });
    });
  }

  /** The strictest reading across a user's roles: highest level wins, recovery needs every role's consent. */
  async effectiveFor(
    tenantId: string,
    userId: string,
  ): Promise<RolePolicy & { hasRoles: boolean }> {
    const roles = await runInTenant(tenantId, async () =>
      (
        await this.prisma.db.userRole.findMany({
          where: { userId },
          select: {
            role: {
              select: {
                mfaLevel: true,
                recoveryEmail: true,
                recoveryCodes: true,
              },
            },
          },
        })
      ).map((u) => u.role),
    );
    if (roles.length === 0)
      return {
        hasRoles: false,
        mfaLevel: 'OPTIONAL',
        recoveryEmail: true,
        recoveryCodes: true,
      };
    return {
      hasRoles: true,
      mfaLevel: highest(roles.map((r) => r.mfaLevel)),
      recoveryEmail: roles.every((r) => r.recoveryEmail),
      recoveryCodes: roles.every((r) => r.recoveryCodes),
    };
  }
}
