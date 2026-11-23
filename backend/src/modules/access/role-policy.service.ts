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
        // Floors are retired (D-65): the policy decides. The column stays for history.
        mfaFloor: 'OFF' as MfaLevelName,
        recoveryEmail: r?.recoveryEmail ?? true,
        recoveryCodes: r?.recoveryCodes ?? true,
      };
    });
  }

  /** No role has a floor any more (D-65). Kept so older callers keep working. */
  floorFor(_roleKey: string): Promise<MfaLevelName> {
    return Promise.resolve('OFF');
  }

  async setPlatformPolicy(roleKey: string, patch: PolicyPatch): Promise<void> {
    const current = (await this.platformPolicies()).find(
      (p) => p.roleKey === roleKey,
    );
    if (!current) throw new NotFoundException('Unknown system role');
    const next = { ...current, ...patch, mfaFloor: 'OFF' as MfaLevelName };
    await runAsSystem(async () => {
      await this.prisma.db.platformRolePolicy.upsert({
        where: { roleKey },
        update: {
          mfaLevel: next.mfaLevel,
          mfaFloor: 'OFF',
          recoveryEmail: next.recoveryEmail,
          recoveryCodes: next.recoveryCodes,
        },
        create: {
          roleKey,
          mfaLevel: next.mfaLevel,
          mfaFloor: 'OFF',
          recoveryEmail: next.recoveryEmail,
          recoveryCodes: next.recoveryCodes,
        },
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
