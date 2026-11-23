import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { TrustedDeviceService } from '../identity/trusted-device.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformRolesService } from './platform-roles.service.js';
import { OWNER_ROLE_ID } from './platform-permissions.js';
import type { AccountAction } from '../identity/account-actions.service.js';

const SENTENCE: Record<AccountAction, string> = {
  'reset-password':
    'Your admin password was reset. Check your email for a link to choose a new one',
  'reset-mfa':
    'Your two-step sign-in was reset. You will set it up again the next time you sign in',
  unlock: 'Your account was unlocked',
  'sign-out-everywhere': 'You were signed out of every device',
  suspend: 'Your admin account was suspended',
  reactivate: 'Your admin account was reactivated',
  'resend-invite': 'Your invitation was sent again. Check your email',
};

/** The same account actions for platform staff (D-63, D-66). Owner rules from PR 2 apply. */
@Injectable()
export class StaffActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: PlatformAuthService,
    private readonly roles: PlatformRolesService,
    private readonly devices: TrustedDeviceService,
    private readonly audit: PlatformAuditService,
    private readonly mail: MailService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async load(id: string) {
    const u = await runAsSystem(
      async () => await this.db.platformUser.findUnique({ where: { id } }),
    );
    if (!u) throw new NotFoundException('No such staff member');
    return u;
  }

  private allowedFor(
    status: 'INVITED' | 'ACTIVE' | 'DISABLED',
    mfa: boolean,
  ): AccountAction[] {
    const out: AccountAction[] = [];
    if (status === 'ACTIVE')
      out.push('reset-password', 'sign-out-everywhere', 'suspend');
    if (status === 'ACTIVE' && mfa) out.push('reset-mfa');
    if (status !== 'DISABLED') out.push('unlock');
    if (status === 'INVITED') out.push('resend-invite');
    if (status === 'DISABLED') out.push('reactivate');
    return [...new Set(out)];
  }

  /** Why this actor may not act on this person, or null. */
  private async blockedFor(
    actorId: string,
    targetId: string,
    targetRoleId: string,
  ) {
    if (actorId === targetId)
      return 'You cannot do this to your own account from here. Use My security.';
    if (
      targetRoleId === OWNER_ROLE_ID &&
      (await this.roles.roleOf(actorId))?.id !== OWNER_ROLE_ID
    )
      return 'Only an Owner can do this to an Owner.';
    return null;
  }

  async account(actorId: string, id: string) {
    const u = await this.load(id);
    const blocked = await this.blockedFor(actorId, id, u.roleId);
    return {
      id: u.id,
      email: u.email,
      name: null,
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      mfaEnabled: Boolean(u.mfaEnabledAt),
      mfaRequired: false,
      trustedDevices: await this.devices.count({ kind: 'platform' }, id),
      roles: [(await this.roles.roleOf(id))?.name ?? ''].filter(Boolean),
      allowed: blocked
        ? []
        : this.allowedFor(u.status, Boolean(u.mfaEnabledAt)),
    };
  }

  async perform(
    actorId: string,
    targetId: string,
    action: AccountAction,
    reason: string,
    ip?: string,
  ): Promise<{ ok: true; link?: string; emailed?: boolean }> {
    const u = await this.load(targetId);
    const why = await this.blockedFor(actorId, targetId, u.roleId);
    if (why) throw new ForbiddenException(why);
    if (!this.allowedFor(u.status, Boolean(u.mfaEnabledAt)).includes(action))
      throw new ConflictException(
        `That does not apply to this account (it is ${u.status.toLowerCase()}).`,
      );
    let link: { link: string; emailed: boolean } | undefined;
    const scope = { kind: 'platform' as const };
    switch (action) {
      case 'reset-password':
        await this.auth.revokeAllSessions(targetId);
        await this.devices.revokeAll(scope, targetId);
        link = await this.auth.sendPasswordLink(targetId, 'reset');
        break;
      case 'reset-mfa':
        await runAsSystem(async () => {
          await this.db.platformRecoveryCode.deleteMany({
            where: { userId: targetId },
          });
          await this.db.platformUser.update({
            where: { id: targetId },
            data: { mfaSecretEnc: null, mfaEnabledAt: null },
          });
        });
        await this.devices.revokeAll(scope, targetId);
        await this.auth.revokeAllSessions(targetId);
        break;
      case 'unlock':
        await this.redis.del(
          `fail:login:platform:acct:${u.email}`,
          `fail:mfa:platform:user:${targetId}`,
          `fail:mfa:stepup:platform:user:${targetId}`,
          `fail:reset:platform:user:${targetId}`,
        );
        break;
      case 'sign-out-everywhere':
        await this.auth.revokeAllSessions(targetId);
        break;
      case 'suspend':
        await this.roles.assertOwnerRemains(targetId, 'disable');
        await runAsSystem(async () => {
          await this.db.platformUser.update({
            where: { id: targetId },
            data: { status: 'DISABLED' },
          });
        });
        await this.auth.revokeAllSessions(targetId);
        break;
      case 'reactivate':
        await runAsSystem(async () => {
          await this.db.platformUser.update({
            where: { id: targetId },
            data: { status: u.passwordHash ? 'ACTIVE' : 'INVITED' },
          });
        });
        break;
      case 'resend-invite':
        link = await this.auth.sendPasswordLink(targetId, 'invite');
        break;
    }
    const actor = await this.load(actorId);
    await this.audit.record({
      actorId,
      action: `platform.staff_${action.replace(/-/g, '_')}`,
      entityType: 'platform_users',
      entityId: targetId,
      meta: { reason },
      ip,
    });
    try {
      await this.mail.send({
        to: u.email,
        subject: 'A change to your admin account',
        text: `${SENTENCE[action]}.\n\nDone by ${actor.email}.\n\nIf you did not expect this, tell another administrator.`,
      });
    } catch {
      // Audited already; a failed notice does not undo it.
    }
    return { ok: true, ...(link ?? {}) };
  }

  /**
   * Break-glass (D-66): clears two-step for a member of staff from the server, when no other Owner can do it
   * in the console. Ends their sessions and records the use.
   */
  async resetMfaFromServer(email: string): Promise<{ id: string }> {
    const u = await runAsSystem(
      async () =>
        await this.db.platformUser.findUnique({
          where: { email: email.toLowerCase() },
        }),
    );
    if (!u) throw new NotFoundException('No platform user with that email');
    await runAsSystem(async () => {
      await this.db.platformRecoveryCode.deleteMany({
        where: { userId: u.id },
      });
      await this.db.platformUser.update({
        where: { id: u.id },
        data: { mfaSecretEnc: null, mfaEnabledAt: null },
      });
    });
    await this.devices.revokeAll({ kind: 'platform' }, u.id);
    await this.auth.revokeAllSessions(u.id);
    await this.audit.record({
      actorId: null,
      action: 'platform.mfa_reset_break_glass',
      entityType: 'platform_users',
      entityId: u.id,
      meta: { by: 'SYSTEM_CLI' },
    });
    return { id: u.id };
  }
}
