import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { AccessService } from '../access/access.service.js';
import { canActOn } from '../access/can-act-on.js';
import { RolePolicyService } from '../access/role-policy.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { TrustedDeviceService } from './trusted-device.service.js';

export type AccountAction =
  | 'reset-password'
  | 'reset-mfa'
  | 'unlock'
  | 'sign-out-everywhere'
  | 'suspend'
  | 'reactivate'
  | 'resend-invite';

/** Who is acting: a company admin, or platform staff acting on a company's account. */
export type Actor =
  | { kind: 'tenant'; userId: string; label: string }
  | { kind: 'platform'; staffId: string; label: string };

const SENTENCE: Record<AccountAction, string> = {
  'reset-password': 'Your password was reset. Check your email for a link to choose a new one',
  'reset-mfa': 'Your two-step sign-in was reset. You will set it up again the next time you sign in',
  unlock: 'Your account was unlocked after too many failed sign-ins',
  'sign-out-everywhere': 'You were signed out of every device',
  suspend: 'Your account was suspended, so you cannot sign in for now',
  reactivate: 'Your account was reactivated',
  'resend-invite': 'Your invitation was sent again. Check your email',
};

/**
 * Account actions on a company user (D-63): reset password or two-step, unlock, sign out everywhere,
 * suspend, reactivate, resend an invite. Each has a reason, is audited in the company's trail and
 * tells the person by email what was done and by whom.
 */
@Injectable()
export class AccountActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly access: AccessService,
    private readonly policies: RolePolicyService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly devices: TrustedDeviceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async user(tenantId: string, id: string) {
    const u = await runInTenant(
      tenantId,
      async () =>
        await this.db.user.findUnique({
          where: { id },
          include: {
            person: { select: { firstName: true, lastName: true } },
            userRoles: { include: { role: { select: { name: true } } } },
          },
        }),
    );
    if (!u || u.tenantId !== tenantId) throw new NotFoundException('No such account');
    return u;
  }

  /** What an admin may do to this account, given its state. */
  private allowedFor(status: 'INVITED' | 'ACTIVE' | 'DISABLED', mfaEnabled: boolean): AccountAction[] {
    const out: AccountAction[] = [];
    if (status === 'ACTIVE') out.push('reset-password', 'sign-out-everywhere', 'suspend');
    if (status === 'ACTIVE' && mfaEnabled) out.push('reset-mfa');
    if (status !== 'DISABLED') out.push('unlock');
    if (status === 'INVITED') out.push('resend-invite', 'suspend');
    if (status === 'DISABLED') out.push('reactivate');
    return [...new Set(out)];
  }

  async account(tenantId: string, id: string, actor?: Actor) {
    const u = await this.user(tenantId, id);
    const policy = await this.policies.effectiveFor(tenantId, id);
    const blocked =
      actor?.kind === 'tenant' ? await this.blockedFor(tenantId, actor.userId, id) : null;
    return {
      id: u.id,
      email: u.email,
      name: u.person ? `${u.person.firstName} ${u.person.lastName}`.trim() : null,
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      mfaEnabled: Boolean(u.mfaEnabledAt),
      mfaRequired: u.mfaRequired || policy.mfaLevel === 'REQUIRED',
      trustedDevices: await this.devices.count({ kind: 'tenant', tenantId }, id),
      roles: u.userRoles.map((r) => r.role.name),
      allowed: blocked ? [] : this.allowedFor(u.status, Boolean(u.mfaEnabledAt)),
    };
  }

  /** Why a company admin may not act on this person, or null. */
  private async blockedFor(tenantId: string, actorId: string, targetId: string) {
    if (actorId === targetId)
      return 'You cannot do this to your own account from here. Use My security.';
    const [mine, theirs] = await Promise.all([
      this.access.permissionsFor(tenantId, actorId),
      this.access.permissionsFor(tenantId, targetId),
    ]);
    if (!canActOn(mine, theirs))
      return 'This person can do things you cannot, so only someone with at least their powers can act on them.';
    return null;
  }

  async perform(
    tenantId: string,
    targetId: string,
    action: AccountAction,
    reason: string,
    actor: Actor,
    ip?: string,
  ): Promise<{ ok: true }> {
    if (actor.kind === 'tenant') {
      const why = await this.blockedFor(tenantId, actor.userId, targetId);
      if (why) throw new ForbiddenException(why);
    }
    const u = await this.user(tenantId, targetId);
    if (!this.allowedFor(u.status, Boolean(u.mfaEnabledAt)).includes(action))
      throw new ConflictException(
        `That does not apply to this account (it is ${u.status.toLowerCase()}).`,
      );
    const scope = { kind: 'tenant' as const, tenantId };
    switch (action) {
      case 'reset-password':
        await this.sessions.revokeAll(tenantId, targetId);
        await this.devices.revokeAll(scope, targetId);
        await this.auth.sendPasswordLink(tenantId, targetId, u.email, 'reset');
        break;
      case 'reset-mfa':
        await runInTenant(tenantId, async () => {
          await this.db.recoveryCode.deleteMany({ where: { userId: targetId } });
          await this.db.user.update({
            where: { id: targetId },
            data: { mfaSecretEnc: null, mfaEnabledAt: null },
          });
        });
        await this.devices.revokeAll(scope, targetId);
        await this.sessions.revokeAll(tenantId, targetId);
        break;
      case 'unlock': {
        const slug = (
          await runAsSystem(
            async () => await this.db.tenant.findUnique({ where: { id: tenantId } }),
          )
        )?.slug;
        await this.redis.del(
          `fail:login:acct:${slug}:${u.email}`,
          `fail:mfa:user:${targetId}`,
          `fail:mfa:stepup:user:${targetId}`,
          `fail:reset:user:${targetId}`,
        );
        break;
      }
      case 'sign-out-everywhere':
        await this.sessions.revokeAll(tenantId, targetId);
        break;
      case 'suspend':
        await runInTenant(tenantId, async () => {
          await this.db.user.update({ where: { id: targetId }, data: { status: 'DISABLED' } });
        });
        await this.sessions.revokeAll(tenantId, targetId);
        break;
      case 'reactivate':
        await runInTenant(tenantId, async () => {
          await this.db.user.update({
            where: { id: targetId },
            data: { status: u.passwordHash ? 'ACTIVE' : 'INVITED' },
          });
        });
        break;
      case 'resend-invite':
        await this.auth.sendPasswordLink(tenantId, targetId, u.email, 'invite');
        break;
    }
    await this.audit.recordSafely({
      tenantId,
      actorType: actor.kind === 'tenant' ? 'USER' : 'PLATFORM',
      actorId: actor.kind === 'tenant' ? actor.userId : actor.staffId,
      action: `account.${action.replace(/-/g, '_')}`,
      entityType: 'users',
      entityId: targetId,
      // The reason is a short note by the admin; never a secret.
      meta: { reason, by: actor.label },
      ip,
    });
    await this.tellPerson(tenantId, u.email, action, actor.label);
    return { ok: true };
  }

  /** The person is told what was done and by whom, so a surprise reset is noticed. */
  private async tellPerson(tenantId: string, email: string, action: AccountAction, by: string) {
    try {
      const tenant = await runAsSystem(
        async () => await this.db.tenant.findUnique({ where: { id: tenantId } }),
      );
      await this.notifications.enqueue(tenantId, 'general.notice', email, {
        subject: 'A change to your account',
        text: `${SENTENCE[action]}.\n\nDone by ${by} at ${tenant?.name ?? 'your company'}.\n\nIf you did not expect this, tell your administrator.`,
      });
    } catch {
      // The action already happened and is audited; a failed notice should not undo it.
    }
  }

  /** A readable name for the admin taking the action, put in the email to the person. */
  async tenantLabel(tenantId: string, userId: string): Promise<string> {
    const u = await runInTenant(
      tenantId,
      async () => await this.db.user.findUnique({ where: { id: userId } }),
    );
    return u?.email ?? 'an administrator';
  }

  /** Everyone with an account in the company, for the admin's Users list. */
  async list(tenantId: string) {
    const rows = await runInTenant(
      tenantId,
      async () =>
        await this.db.user.findMany({
          orderBy: { email: 'asc' },
          take: 500,
          include: {
            person: { select: { firstName: true, lastName: true } },
            userRoles: { include: { role: { select: { name: true } } } },
          },
        }),
    );
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.person ? `${u.person.firstName} ${u.person.lastName}`.trim() : null,
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      mfaEnabled: Boolean(u.mfaEnabledAt),
      roles: u.userRoles.map((r) => r.role.name),
    }));
  }

  /** Used by routes to refuse a bad action name early. */
  static assertAction(a: string): asserts a is AccountAction {
    if (!(a in SENTENCE)) throw new BadRequestException('Unknown action');
  }
}
