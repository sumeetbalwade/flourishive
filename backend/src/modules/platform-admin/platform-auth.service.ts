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
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { MfaService, hashRecoveryCode } from '../identity/mfa.service.js';
import { OtpService } from '../identity/otp.service.js';
import { PasswordService } from '../identity/password.service.js';
import { ThrottleService } from '../identity/throttle.service.js';
import { TokenService, sha256 } from '../identity/token.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

export type PlatformLogin =
  | { status: 'ok'; tokens: PlatformTokens }
  | { status: 'mfa_required'; mfaToken: string }
  | { status: 'mfa_setup_required'; mfaToken: string };

export interface PlatformTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTtlMs: number;
}

const REFRESH_DAYS = 7;
const resetKey = (token: string) => `pwreset-platform:${sha256(token)}`;
const revokedKey = (sessionId: string) =>
  `revoked:platform-session:${sessionId}`;

/** Sign-in for super admin staff: password, then an authenticator code, always. */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly throttle: ThrottleService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly audit: PlatformAuditService,
    private readonly settings: SettingsService,
    private readonly otp: OtpService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private db() {
    return this.prisma.db;
  }

  private user(id: string) {
    return runAsSystem(
      async () => await this.db().platformUser.findUnique({ where: { id } }),
    );
  }

  async login(
    input: { email: string; password: string },
    meta: { ip?: string; userAgent?: string },
  ): Promise<PlatformLogin> {
    const ip = meta.ip;
    const email = input.email.toLowerCase();
    const keys = [`platform:acct:${email}`, `platform:ip:${ip ?? 'unknown'}`];
    await this.throttle.assertNotLocked('login', ...keys);
    const user = await runAsSystem(
      async () => await this.db().platformUser.findUnique({ where: { email } }),
    );
    const ok =
      user?.passwordHash && user.status === 'ACTIVE'
        ? await this.passwords.verify(input.password, user.passwordHash)
        : false;
    if (!user?.passwordHash) await this.passwords.verifyDummy(input.password);
    if (!ok || !user) {
      await this.throttle.recordFailure('login', ...keys);
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.throttle.clear('login', keys[0]!);
    // Someone who already enrolled is always asked for a code; otherwise the platform policy decides.
    if (
      !user.mfaEnabledAt &&
      (await this.settings.getPlatform('platform.superAdminMfa')) !== 'REQUIRED'
    )
      return { status: 'ok', tokens: await this.startSession(user.id, meta) };
    const purpose = user.mfaEnabledAt ? 'mfa-verify' : 'mfa-setup';
    const mfaToken = await this.tokens.signPlatformMfa({
      platformUserId: user.id,
      purpose,
    });
    return {
      status: user.mfaEnabledAt ? 'mfa_required' : 'mfa_setup_required',
      mfaToken,
    };
  }

  async verifyMfa(
    input: { mfaToken: string; code?: string; recoveryCode?: string },
    meta: { ip?: string; userAgent?: string },
  ): Promise<PlatformTokens> {
    const c = await this.tokens.verifyPlatformMfa(input.mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `platform:user:${c.platformUserId}`;
    await this.throttle.assertNotLocked('mfa', key);
    const user = await this.user(c.platformUserId);
    let ok = false;
    if (user?.status === 'ACTIVE' && user.mfaSecretEnc) {
      if (input.code) {
        ok = await this.mfa.verifyCode(user.mfaSecretEnc, input.code);
        if (ok)
          ok =
            (await this.redis.client.set(
              `totp:used:platform:${user.id}:${input.code}`,
              '1',
              'EX',
              120,
              'NX',
            )) === 'OK';
      } else if (input.recoveryCode) {
        ok = await runAsSystem(
          async () =>
            (
              await this.db().platformRecoveryCode.updateMany({
                where: {
                  userId: user.id,
                  codeHash: hashRecoveryCode(input.recoveryCode!),
                  usedAt: null,
                },
                data: { usedAt: new Date() },
              })
            ).count === 1,
        );
      }
    }
    if (!ok || !user) {
      await this.throttle.recordFailure('mfa', key);
      throw new UnauthorizedException('Invalid code');
    }
    await this.throttle.clear('mfa', key);
    return this.startSession(user.id, meta);
  }

  /**
   * Lost authenticator: after the password step, a code emailed to the account lets the person
   * enrol again. Switched off with platform.superAdminRecoveryEmail.
   */
  async startMfaEmailRecovery(mfaToken: string): Promise<void> {
    const c = await this.tokens.verifyPlatformMfa(mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `platform:user:${c.platformUserId}`;
    await this.throttle.assertNotLocked('reset', key);
    await this.throttle.recordFailure('reset', key);
    if (!(await this.settings.getPlatform('platform.superAdminRecoveryEmail')))
      throw new ForbiddenException(
        'Email recovery is turned off for platform staff',
      );
    const user = await this.user(c.platformUserId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    const code = await this.otp.issue('platform-mfa', user.id, 600);
    await this.mail.send({
      to: user.email,
      subject: `Your ${this.config.APP_NAME} admin code: ${code}`,
      text: `Your one-time code is ${code}. It works once and expires in 10 minutes.\n\nIf you did not ask for it, change your password now.`,
    });
  }

  async verifyMfaEmailRecovery(
    input: { mfaToken: string; code: string },
    meta: { ip?: string },
  ): Promise<{ status: 'mfa_setup_required'; mfaToken: string }> {
    const c = await this.tokens.verifyPlatformMfa(input.mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `platform:user:${c.platformUserId}`;
    await this.throttle.assertNotLocked('mfa', key);
    const user = await this.user(c.platformUserId);
    const ok =
      !!user &&
      user.status === 'ACTIVE' &&
      (await this.settings.getPlatform('platform.superAdminRecoveryEmail')) &&
      (await this.otp.verify('platform-mfa', user.id, input.code));
    if (!ok || !user) {
      await this.throttle.recordFailure('mfa', key);
      throw new UnauthorizedException('Invalid or expired code');
    }
    await this.throttle.clear('mfa', key);
    await runAsSystem(async () => {
      await this.db().platformRecoveryCode.deleteMany({
        where: { userId: user.id },
      });
      await this.db().platformUser.update({
        where: { id: user.id },
        data: { mfaSecretEnc: null, mfaEnabledAt: null },
      });
      await this.db().platformSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.audit.record({
      actorId: user.id,
      action: 'platform.mfa_reset_via_email',
      entityType: 'platform_users',
      entityId: user.id,
      ip: meta.ip,
    });
    return {
      status: 'mfa_setup_required',
      mfaToken: await this.tokens.signPlatformMfa({
        platformUserId: user.id,
        purpose: 'mfa-setup',
      }),
    };
  }

  async beginMfaSetup(mfaToken: string) {
    const user = await this.setupUser(mfaToken);
    const secret = this.mfa.newSecret();
    await runAsSystem(async () => {
      await this.db().platformUser.update({
        where: { id: user.id },
        data: { mfaSecretEnc: this.mfa.encryptSecret(secret) },
      });
    });
    return { secret, otpauthUri: this.mfa.otpauthUri(secret, user.email) };
  }

  async confirmMfaSetup(
    mfaToken: string,
    code: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const user = await this.setupUser(mfaToken);
    await this.throttle.assertNotLocked('mfa', `platform:user:${user.id}`);
    if (
      !user.mfaSecretEnc ||
      !(await this.mfa.verifyCode(user.mfaSecretEnc, code))
    ) {
      await this.throttle.recordFailure('mfa', `platform:user:${user.id}`);
      throw new UnauthorizedException('Invalid code');
    }
    const { codes, hashes } = this.mfa.newRecoveryCodes();
    await runAsSystem(async () => {
      await this.db().platformRecoveryCode.deleteMany({
        where: { userId: user.id },
      });
      await this.db().platformRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
      await this.db().platformUser.update({
        where: { id: user.id },
        data: { mfaEnabledAt: new Date() },
      });
    });
    await this.audit.record({
      actorId: user.id,
      action: 'platform.mfa_enabled',
      entityType: 'platform_users',
      entityId: user.id,
      ip: meta.ip,
    });
    return {
      recoveryCodes: codes,
      tokens: await this.startSession(user.id, meta),
    };
  }

  private async setupUser(mfaToken: string) {
    const c = await this.tokens.verifyPlatformMfa(mfaToken);
    if (c.purpose !== 'mfa-setup')
      throw new UnauthorizedException('Invalid token');
    const user = await this.user(c.platformUserId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    if (user.mfaEnabledAt)
      throw new ConflictException('MFA is already enabled');
    return user;
  }

  private async startSession(
    userId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<PlatformTokens> {
    const refresh = this.tokens.newRefreshToken();
    const refreshTtlMs = REFRESH_DAYS * 24 * 3600 * 1000;
    const expiresAt = new Date(Date.now() + refreshTtlMs);
    const sessionId = await runAsSystem(async () => {
      const s = await this.db().platformSession.create({
        data: {
          userId,
          expiresAt,
          ip: meta.ip?.slice(0, 64),
          userAgent: meta.userAgent?.slice(0, 255),
        },
      });
      await this.db().platformRefreshToken.create({
        data: { sessionId: s.id, tokenHash: refresh.hash, expiresAt },
      });
      await this.db().platformUser.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
      return s.id;
    });
    await this.audit.record({
      actorId: userId,
      action: 'platform.login',
      entityType: 'platform_users',
      entityId: userId,
      ip: meta.ip,
    });
    return this.issue(userId, sessionId, refresh.token, refreshTtlMs);
  }

  private async issue(
    userId: string,
    sessionId: string,
    refreshToken: string,
    refreshTtlMs: number,
  ): Promise<PlatformTokens> {
    return {
      accessToken: await this.tokens.signPlatformAccess({
        platformUserId: userId,
        sessionId,
      }),
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshTtlMs,
    };
  }

  async refresh(presented: string): Promise<PlatformTokens> {
    const row = await runAsSystem(
      async () =>
        await this.db().platformRefreshToken.findUnique({
          where: { tokenHash: sha256(presented) },
          include: { session: { include: { user: true } } },
        }),
    );
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    const { session } = row;
    if (row.usedAt) {
      await this.revokeSession(session.id);
      await this.audit.record({
        actorId: session.userId,
        action: 'platform.refresh_token_reuse',
        entityType: 'platform_sessions',
        entityId: session.id,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    const now = new Date();
    if (
      session.revokedAt ||
      session.expiresAt < now ||
      row.expiresAt < now ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Session expired');
    }
    const next = this.tokens.newRefreshToken();
    const refreshTtlMs = REFRESH_DAYS * 24 * 3600 * 1000;
    const claimed = await runAsSystem(async () => {
      const res = await this.db().platformRefreshToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (res.count !== 1) return false;
      await this.db().platformRefreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: next.hash,
          expiresAt: new Date(Date.now() + refreshTtlMs),
        },
      });
      return true;
    });
    if (!claimed) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issue(session.userId, session.id, next.token, refreshTtlMs);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await runAsSystem(async () => {
      await this.db().platformSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.redis.client.set(
      revokedKey(sessionId),
      '1',
      'EX',
      this.config.ACCESS_TOKEN_TTL_SECONDS + 5,
    );
  }

  isRevoked = async (sessionId: string) =>
    (await this.redis.client.exists(revokedKey(sessionId))) === 1;

  async me(userId: string) {
    const u = await this.user(userId);
    if (!u) throw new UnauthorizedException();
    return { id: u.id, email: u.email, mfaEnabled: Boolean(u.mfaEnabledAt) };
  }

  /** Creates or re-issues an invite. Returns the link so a CLI operator can hand it over. */
  async invite(
    email: string,
    actorId: string | null,
  ): Promise<{ id: string; link: string; emailed: boolean }> {
    const address = email.toLowerCase();
    const existing = await runAsSystem(
      async () =>
        await this.db().platformUser.findUnique({ where: { email: address } }),
    );
    if (existing && existing.status !== 'INVITED')
      throw new ConflictException('That person already has an account');
    const user =
      existing ??
      (await runAsSystem(
        async () =>
          await this.db().platformUser.create({ data: { email: address } }),
      ));
    const token = randomBytes(32).toString('base64url');
    await this.redis.setJson(
      resetKey(token),
      { userId: user.id },
      7 * 24 * 3600,
    );
    const link = `${this.config.ADMIN_URL}/#/set-password?token=${token}`;
    let emailed = true;
    try {
      await this.mail.send({
        to: address,
        subject: `You have been invited to the ${this.config.APP_NAME} admin console`,
        text: `Choose a password (link valid for 7 days):\n\n${link}`,
      });
    } catch {
      emailed = false;
    }
    await this.audit.record({
      actorId,
      action: 'platform.user_invited',
      entityType: 'platform_users',
      entityId: user.id,
      meta: { emailed },
    });
    return { id: user.id, link, emailed };
  }

  async setPassword(token: string, password: string): Promise<void> {
    const claim = await this.redis.getJson<{ userId: string }>(resetKey(token));
    if (!claim)
      throw new BadRequestException('This link is invalid or has expired');
    this.passwords.assertAcceptable(password, 14); // staff with platform-wide access: stricter than tenants
    if ((await this.redis.del(resetKey(token))) !== 1)
      throw new BadRequestException('This link is invalid or has expired');
    const passwordHash = await this.passwords.hash(password);
    await runAsSystem(async () => {
      await this.db().platformUser.update({
        where: { id: claim.userId },
        data: { passwordHash, status: 'ACTIVE' },
      });
      await this.db().platformSession.updateMany({
        where: { userId: claim.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.audit.record({
      actorId: claim.userId,
      action: 'platform.password_set',
      entityType: 'platform_users',
      entityId: claim.userId,
    });
  }
}
