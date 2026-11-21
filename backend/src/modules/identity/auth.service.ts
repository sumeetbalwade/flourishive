import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AccessService } from '../access/access.service.js';
import { RolePolicyService } from '../access/role-policy.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { OtpService } from './otp.service.js';
import { GoogleService } from './google.service.js';
import { MfaService, hashRecoveryCode } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import {
  SessionService,
  type ClientMeta,
  type IssuedTokens,
} from './session.service.js';
import { ThrottleService } from './throttle.service.js';
import {
  TokenService,
  sha256,
  type MfaChallengePurpose,
} from './token.service.js';

export type LoginResult =
  | { status: 'ok'; tokens: IssuedTokens }
  | { status: 'mfa_required'; mfaToken: string }
  | { status: 'mfa_setup_required'; mfaToken: string };

export interface Principal {
  tenantId: string;
  userId: string;
}

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  status: string;
  passwordHash: string | null;
  mfaSecretEnc: string | null;
  mfaEnabledAt: Date | null;
  mfaRequired: boolean;
}

const INVALID = 'Invalid credentials';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly google: GoogleService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly policies: RolePolicyService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async tenantIdFor(slug: string): Promise<string | null> {
    const tenant = await runAsSystem(
      async () =>
        await this.prisma.db.tenant.findUnique({
          where: { slug: slug.toLowerCase() },
        }),
    );
    return tenant && tenant.status === 'ACTIVE' ? tenant.id : null;
  }

  private findUser(
    tenantId: string,
    where: { email: string } | { id: string },
  ): Promise<UserRow | null> {
    return runInTenant(tenantId, async () => {
      const w =
        'email' in where
          ? { tenantId_email: { tenantId, email: where.email.toLowerCase() } }
          : { id: where.id };
      return (await this.prisma.db.user.findUnique({
        where: w as never,
      })) as UserRow | null;
    });
  }

  /**
   * Two-step is required by the user's own flag or by the strictest level among their roles.
   * OFF stops enforcement; someone who already enrolled is still asked for a code.
   */
  private async mfaIsRequired(user: UserRow): Promise<boolean> {
    if (user.mfaRequired) return true;
    return (
      (await this.policies.effectiveFor(user.tenantId, user.id)).mfaLevel ===
      'REQUIRED'
    );
  }

  /** After the first factor: decide whether MFA is needed before issuing tokens. */
  private async afterFirstFactor(
    user: UserRow,
    meta: ClientMeta,
    via: 'password' | 'google',
  ): Promise<LoginResult> {
    if (user.mfaEnabledAt) {
      const mfaToken = await this.tokens.signMfaChallenge({
        userId: user.id,
        tenantId: user.tenantId,
        purpose: 'mfa-verify',
      });
      return { status: 'mfa_required', mfaToken };
    }
    if (await this.mfaIsRequired(user)) {
      const mfaToken = await this.tokens.signMfaChallenge({
        userId: user.id,
        tenantId: user.tenantId,
        purpose: 'mfa-setup',
      });
      return { status: 'mfa_setup_required', mfaToken };
    }
    return {
      status: 'ok',
      tokens: await this.startAudited(user.tenantId, user.id, meta, via),
    };
  }

  /** Starts a session and records the sign-in (and how: password, google, mfa). */
  private async startAudited(
    tenantId: string,
    userId: string,
    meta: ClientMeta,
    via: string,
  ): Promise<IssuedTokens> {
    const tokens = await this.sessions.start(tenantId, userId, meta);
    await this.audit.recordSafely({
      tenantId,
      actorType: 'USER',
      actorId: userId,
      action: 'auth.login',
      entityType: 'users',
      entityId: userId,
      meta: { via },
      ip: meta.ip,
    });
    return tokens;
  }

  private auditUser(
    tenantId: string,
    userId: string | null,
    action: string,
    meta: ClientMeta,
    extra?: Record<string, unknown>,
  ) {
    return this.audit.recordSafely({
      tenantId,
      actorType: userId ? 'USER' : 'SYSTEM',
      actorId: userId,
      action,
      entityType: 'users',
      entityId: userId,
      meta: extra ?? null,
      ip: meta.ip,
    });
  }

  async login(
    input: { tenant: string; email: string; password: string },
    meta: ClientMeta,
  ): Promise<LoginResult> {
    const acct = `${input.tenant.toLowerCase()}:${input.email.toLowerCase()}`;
    const ip = meta.ip ?? 'unknown';
    const tenantId = await this.tenantIdFor(input.tenant);
    await this.throttle.assertBelow(
      'login',
      tenantId
        ? await this.settings.get('security.loginAttempts', { tenantId })
        : 5,
      `acct:${acct}`,
      `ip:${ip}`,
    );
    const user = tenantId
      ? await this.findUser(tenantId, { email: input.email })
      : null;
    const ok =
      user?.passwordHash && user.status === 'ACTIVE'
        ? await this.passwords.verify(input.password, user.passwordHash)
        : false;
    if (!user?.passwordHash) await this.passwords.verifyDummy(input.password);
    if (!ok || !user) {
      await this.throttle.recordFailure('login', `acct:${acct}`, `ip:${ip}`);
      if (user)
        await this.auditUser(user.tenantId, user.id, 'auth.login_failed', meta);
      throw new UnauthorizedException(INVALID);
    }
    await this.throttle.clear('login', `acct:${acct}`);
    return this.afterFirstFactor(user, meta, 'password');
  }

  async loginWithGoogle(
    input: { tenant: string; idToken: string },
    meta: ClientMeta,
  ): Promise<LoginResult> {
    await this.throttle.assertNotLocked('login', `ip:${meta.ip ?? 'unknown'}`);
    const identity = await this.google.verify(input.idToken);
    const tenantId = await this.tenantIdFor(input.tenant);
    // Only people HR has already created can sign in; Google never creates accounts.
    const user = tenantId
      ? await this.findUser(tenantId, { email: identity.email })
      : null;
    if (!user || user.status === 'DISABLED') {
      await this.throttle.recordFailure('login', `ip:${meta.ip ?? 'unknown'}`);
      throw new UnauthorizedException(INVALID);
    }
    await runInTenant(user.tenantId, async () => {
      // Pin the account to the first Google identity that signs in; a different one is refused.
      const row = await this.prisma.db.user.findUnique({
        where: { id: user.id },
      });
      if (row?.googleSub && row.googleSub !== identity.sub)
        throw new UnauthorizedException(INVALID);
      await this.prisma.db.user.update({
        where: { id: user.id },
        data: { googleSub: identity.sub, status: 'ACTIVE' },
      });
    });
    return this.afterFirstFactor({ ...user, status: 'ACTIVE' }, meta, 'google');
  }

  async verifyMfa(
    input: { mfaToken: string; code?: string; recoveryCode?: string },
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const claims = await this.tokens.verifyMfaChallenge(input.mfaToken);
    if (claims.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `user:${claims.userId}`;
    await this.throttle.assertNotLocked('mfa', key);

    const user = await this.findUser(claims.tenantId, { id: claims.userId });
    let ok = false;
    if (user?.status === 'ACTIVE' && user.mfaEnabledAt && user.mfaSecretEnc) {
      if (input.code) {
        ok = await this.mfa.verifyCode(user.mfaSecretEnc, input.code);
        // A code is single-use inside its validity window, so a replayed code fails.
        if (ok) {
          const fresh = await this.redis.client.set(
            `totp:used:${user.id}:${input.code}`,
            '1',
            'EX',
            120,
            'NX',
          );
          ok = fresh === 'OK';
        }
      } else if (input.recoveryCode)
        ok = await this.useRecoveryCode(
          claims.tenantId,
          user.id,
          input.recoveryCode,
        );
    }
    if (!ok || !user) {
      await this.throttle.recordFailure('mfa', key);
      await this.auditUser(
        claims.tenantId,
        claims.userId,
        'auth.mfa_failed',
        meta,
      );
      throw new UnauthorizedException('Invalid code');
    }
    await this.throttle.clear('mfa', key);
    return this.startAudited(
      claims.tenantId,
      user.id,
      meta,
      input.recoveryCode ? 'mfa-recovery-code' : 'mfa',
    );
  }

  private useRecoveryCode(
    tenantId: string,
    userId: string,
    code: string,
  ): Promise<boolean> {
    return runInTenant(tenantId, async () => {
      const res = await this.prisma.db.recoveryCode.updateMany({
        where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
        data: { usedAt: new Date() },
      });
      return res.count === 1;
    });
  }

  /** Step 1 of enrolment: create a secret (not active until confirmed). */
  async beginMfaSetup(
    who: Principal,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.findUser(who.tenantId, { id: who.userId });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    if (user.mfaEnabledAt)
      throw new ConflictException('MFA is already enabled');
    const secret = this.mfa.newSecret();
    await runInTenant(who.tenantId, async () => {
      await this.prisma.db.user.update({
        where: { id: who.userId },
        data: { mfaSecretEnc: this.mfa.encryptSecret(secret) },
      });
    });
    return { secret, otpauthUri: this.mfa.otpauthUri(secret, user.email) };
  }

  /** Step 2: prove the app works, turn MFA on and hand out recovery codes once. */
  async confirmMfaSetup(
    who: Principal,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.throttle.assertNotLocked('mfa', `user:${who.userId}`);
    const user = await this.findUser(who.tenantId, { id: who.userId });
    if (!user?.mfaSecretEnc || user.mfaEnabledAt)
      throw new BadRequestException('Start MFA setup first');
    if (!(await this.mfa.verifyCode(user.mfaSecretEnc, code))) {
      await this.throttle.recordFailure('mfa', `user:${who.userId}`);
      throw new UnauthorizedException('Invalid code');
    }
    const { codes, hashes } = this.mfa.newRecoveryCodes();
    await runInTenant(who.tenantId, async () => {
      await this.prisma.db.recoveryCode.deleteMany({
        where: { userId: who.userId },
      });
      await this.prisma.db.recoveryCode.createMany({
        data: hashes.map((codeHash) => ({
          tenantId: who.tenantId,
          userId: who.userId,
          codeHash,
        })),
      });
      await this.prisma.db.user.update({
        where: { id: who.userId },
        data: { mfaEnabledAt: new Date() },
      });
    });
    await this.auditUser(who.tenantId, who.userId, 'auth.mfa_enabled', {});
    return { recoveryCodes: codes };
  }

  /** Completes a login that was waiting on mandatory MFA enrolment. */
  startSession(who: Principal, meta: ClientMeta): Promise<IssuedTokens> {
    return this.startAudited(who.tenantId, who.userId, meta, 'mfa-enrolment');
  }

  async challengePrincipal(
    mfaToken: string,
    purpose: MfaChallengePurpose,
  ): Promise<Principal> {
    const c = await this.tokens.verifyMfaChallenge(mfaToken);
    if (c.purpose !== purpose) throw new UnauthorizedException('Invalid token');
    return { tenantId: c.tenantId, userId: c.userId };
  }

  refresh(token: string) {
    return this.sessions.rotate(token);
  }

  logout(who: Principal, sessionId: string) {
    return this.sessions.revoke(who.tenantId, sessionId);
  }

  logoutEverywhere(who: Principal) {
    return this.sessions.revokeAll(who.tenantId, who.userId);
  }

  async me(who: Principal) {
    const user = await this.findUser(who.tenantId, { id: who.userId });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      mfaEnabled: Boolean(user.mfaEnabledAt),
      mfaRequired: await this.mfaIsRequired(user),
      mfaLevel: (await this.policies.effectiveFor(user.tenantId, user.id))
        .mfaLevel,
      permissions: Object.keys(
        await this.access.permissionsFor(who.tenantId, who.userId),
      ).sort(),
    };
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to find accounts. */
  async forgotPassword(
    input: { tenant: string; email: string },
    meta: ClientMeta,
  ): Promise<void> {
    const ip = `ip:${meta.ip ?? 'unknown'}`;
    await this.throttle.assertNotLocked('reset', ip);
    await this.throttle.recordFailure('reset', ip);
    const tenantId = await this.tenantIdFor(input.tenant);
    const user = tenantId
      ? await this.findUser(tenantId, { email: input.email })
      : null;
    if (!user || user.status === 'DISABLED') return;

    await this.sendPasswordLink(user.tenantId, user.id, user.email, 'reset');
  }

  /** Emails a single-use link to choose a password (reset: one hour, invite: seven days). */
  async sendPasswordLink(
    tenantId: string,
    userId: string,
    to: string,
    kind: 'reset' | 'invite',
  ): Promise<void> {
    const token = await this.mintResetToken(
      tenantId,
      userId,
      kind === 'invite' ? 7 * 24 * 3600 : 3600,
    );
    const link = `${this.config.WEB_URL}/#/reset-password?token=${token}`;
    await this.notifications.sendNow(
      tenantId,
      kind === 'invite' ? 'auth.invite' : 'auth.password_reset',
      to,
      { link },
    );
  }

  private async mintResetToken(
    tenantId: string,
    userId: string,
    ttlSeconds: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.setJson(
      `pwreset:${sha256(token)}`,
      { tenantId, userId },
      ttlSeconds,
    );
    return token;
  }

  /** Emails a fresh one-time code. Only a hash is kept; the code is not stored in notifications. */
  private async emailOtp(
    user: UserRow,
    purpose: 'password' | 'mfa',
  ): Promise<void> {
    const minutes = await this.settings.get('security.otpExpiryMinutes', {
      tenantId: user.tenantId,
    });
    const code = await this.otp.issue(purpose, user.id, minutes * 60);
    await this.mail.send({
      to: user.email,
      subject: `Your ${this.config.APP_NAME} code: ${code}`,
      text: `Your one-time code is ${code}. It works once and expires in ${minutes} minutes.\n\nIf you did not ask for it, ignore this email and consider changing your password.`,
      fromName: await this.settings.get('branding.emailSenderName', {
        tenantId: user.tenantId,
      }),
    });
  }

  /** Forgot password, step 1: email a code. Looks the same to the caller whether or not the account exists. */
  async startEmailRecovery(
    input: { tenant: string; email: string },
    meta: ClientMeta,
  ): Promise<void> {
    const ip = `ip:${meta.ip ?? 'unknown'}`;
    const acct = `acct:${input.tenant.toLowerCase()}:${input.email.toLowerCase()}`;
    await this.throttle.assertNotLocked('reset', ip, acct);
    await this.throttle.recordFailure('reset', ip, acct);
    const tenantId = await this.tenantIdFor(input.tenant);
    const user = tenantId
      ? await this.findUser(tenantId, { email: input.email })
      : null;
    if (!user || user.status === 'DISABLED') return;
    if (
      !(await this.policies.effectiveFor(user.tenantId, user.id)).recoveryEmail
    )
      return;
    await this.emailOtp(user, 'password');
    await this.auditUser(
      user.tenantId,
      user.id,
      'auth.recovery_code_sent',
      meta,
      {
        purpose: 'password',
      },
    );
  }

  /** Forgot password, step 2: a correct code returns a single-use reset token for POST /auth/reset-password. */
  async verifyEmailRecovery(
    input: { tenant: string; email: string; code: string },
    meta: ClientMeta,
  ): Promise<{ resetToken: string }> {
    const keys = [
      `ip:${meta.ip ?? 'unknown'}`,
      `acct:${input.tenant.toLowerCase()}:${input.email.toLowerCase()}`,
    ];
    await this.throttle.assertNotLocked('mfa', ...keys);
    const tenantId = await this.tenantIdFor(input.tenant);
    const user = tenantId
      ? await this.findUser(tenantId, { email: input.email })
      : null;
    const ok =
      !!user &&
      user.status !== 'DISABLED' &&
      (await this.policies.effectiveFor(user.tenantId, user.id))
        .recoveryEmail &&
      (await this.otp.verify('password', user.id, input.code));
    if (!ok || !user) {
      await this.throttle.recordFailure('mfa', ...keys);
      throw new UnauthorizedException('Invalid or expired code');
    }
    await this.throttle.clear('mfa', ...keys);
    await this.auditUser(
      user.tenantId,
      user.id,
      'auth.recovery_code_verified',
      meta,
      {
        purpose: 'password',
      },
    );
    return {
      resetToken: await this.mintResetToken(user.tenantId, user.id, 900),
    };
  }

  /**
   * Lost authenticator: after the password was accepted, a code sent to the account email
   * lets the person start two-step again. The person needs both the password and the inbox.
   */
  async startMfaEmailRecovery(
    mfaToken: string,
    meta: ClientMeta,
  ): Promise<void> {
    const who = await this.challengePrincipal(mfaToken, 'mfa-verify');
    await this.throttle.assertNotLocked('reset', `user:${who.userId}`);
    await this.throttle.recordFailure('reset', `user:${who.userId}`);
    const user = await this.findUser(who.tenantId, { id: who.userId });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    if (
      !(await this.policies.effectiveFor(who.tenantId, who.userId))
        .recoveryEmail
    )
      throw new ForbiddenException(
        'Recovery by email is not allowed for your role. Ask your administrator.',
      );
    await this.emailOtp(user, 'mfa');
    await this.auditUser(
      who.tenantId,
      who.userId,
      'auth.recovery_code_sent',
      meta,
      {
        purpose: 'mfa',
      },
    );
  }

  async verifyMfaEmailRecovery(
    input: { mfaToken: string; code: string },
    meta: ClientMeta,
  ): Promise<{ status: 'mfa_setup_required'; mfaToken: string }> {
    const who = await this.challengePrincipal(input.mfaToken, 'mfa-verify');
    const key = `user:${who.userId}`;
    await this.throttle.assertNotLocked('mfa', key);
    const user = await this.findUser(who.tenantId, { id: who.userId });
    const ok =
      !!user &&
      user.status === 'ACTIVE' &&
      (await this.policies.effectiveFor(who.tenantId, who.userId))
        .recoveryEmail &&
      (await this.otp.verify('mfa', who.userId, input.code));
    if (!ok) {
      await this.throttle.recordFailure('mfa', key);
      throw new UnauthorizedException('Invalid or expired code');
    }
    await this.throttle.clear('mfa', key);
    await runInTenant(who.tenantId, async () => {
      await this.prisma.db.recoveryCode.deleteMany({
        where: { userId: who.userId },
      });
      await this.prisma.db.user.update({
        where: { id: who.userId },
        data: { mfaSecretEnc: null, mfaEnabledAt: null },
      });
    });
    await this.sessions.revokeAll(who.tenantId, who.userId);
    await this.auditUser(
      who.tenantId,
      who.userId,
      'auth.mfa_reset_via_email',
      meta,
    );
    return {
      status: 'mfa_setup_required',
      mfaToken: await this.tokens.signMfaChallenge({
        userId: who.userId,
        tenantId: who.tenantId,
        purpose: 'mfa-setup',
      }),
    };
  }

  async resetPassword(input: {
    token: string;
    password: string;
  }): Promise<void> {
    const key = `pwreset:${sha256(input.token)}`;
    const claim = await this.redis.getJson<Principal>(key);
    if (!claim)
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    this.passwords.assertAcceptable(
      input.password,
      await this.settings.get('security.passwordMinLength', {
        tenantId: claim.tenantId,
      }),
    );
    if ((await this.redis.del(key)) !== 1)
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    const passwordHash = await this.passwords.hash(input.password);
    await runInTenant(claim.tenantId, async () => {
      await this.prisma.db.user.update({
        where: { id: claim.userId },
        data: { passwordHash, status: 'ACTIVE' },
      });
    });
    await this.sessions.revokeAll(claim.tenantId, claim.userId);
    await this.auditUser(
      claim.tenantId,
      claim.userId,
      'auth.password_changed',
      {},
      { via: 'reset-link' },
    );
  }
}
