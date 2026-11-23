import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
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
import { TrustedDeviceService } from '../identity/trusted-device.service.js';
import {
  PasskeyService,
  type RelyingParty,
} from '../identity/passkey.service.js';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PlatformRolesService } from './platform-roles.service.js';
import { OWNER_ROLE_ID } from './platform-permissions.js';
import { PlatformAuditService } from './platform-audit.service.js';

export type PlatformLogin =
  | { status: 'ok'; tokens: PlatformTokens }
  | {
      status: 'mfa_required';
      mfaToken: string;
      methods: { code: boolean; passkey: boolean };
    }
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
    private readonly roles: PlatformRolesService,
    private readonly runtime: RuntimeConfigService,
    private readonly devices: TrustedDeviceService,
    private readonly passkeys: PasskeyService,
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
    trustedToken?: string,
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
    const scope = { kind: 'platform' as const };
    const hasPasskey = (await this.passkeys.count(scope, user.id)) > 0;
    // Someone who already enrolled is always asked for a code; otherwise the platform policy decides.
    if (
      !user.mfaEnabledAt &&
      !hasPasskey &&
      (await this.settings.getPlatform('platform.superAdminMfa')) !== 'REQUIRED'
    )
      return { status: 'ok', tokens: await this.startSession(user.id, meta) };
    // A remembered device skips the code (D-64).
    if (
      user.mfaEnabledAt &&
      (await this.devices.check(scope, user.id, trustedToken))
    )
      return { status: 'ok', tokens: await this.startSession(user.id, meta) };
    // A passkey is a second factor too, and it satisfies a REQUIRED policy.
    if (!user.mfaEnabledAt && !hasPasskey) {
      return {
        status: 'mfa_setup_required',
        mfaToken: await this.tokens.signPlatformMfa({
          platformUserId: user.id,
          purpose: 'mfa-setup',
        }),
      };
    }
    return {
      status: 'mfa_required',
      mfaToken: await this.tokens.signPlatformMfa({
        platformUserId: user.id,
        purpose: 'mfa-verify',
      }),
      methods: { code: Boolean(user.mfaEnabledAt), passkey: hasPasskey },
    };
  }

  async verifyMfa(
    input: {
      mfaToken: string;
      code?: string;
      recoveryCode?: string;
      emailCode?: string;
      remember?: boolean;
    },
    meta: { ip?: string; userAgent?: string },
  ): Promise<
    PlatformTokens & { trustedDevice?: { token: string; maxAgeMs: number } }
  > {
    const c = await this.tokens.verifyPlatformMfa(input.mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `platform:user:${c.platformUserId}`;
    await this.throttle.assertNotLocked('mfa', key);
    const user = await this.user(c.platformUserId);
    let ok = false;
    if (user?.status === 'ACTIVE' && user.mfaEnabledAt && input.emailCode) {
      // "Email me a code instead", where platform recovery by email is allowed.
      ok =
        (await this.settings.getPlatform('platform.superAdminRecoveryEmail')) &&
        (await this.otp.verify(
          'platform-mfa-signin',
          user.id,
          input.emailCode,
        ));
    } else if (user?.status === 'ACTIVE' && user.mfaSecretEnc) {
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
    const tokens = await this.startSession(user.id, meta);
    const days = input.remember
      ? await this.settings.getPlatform('platform.trustedDeviceDays')
      : 0;
    const trustedDevice = await this.devices.remember(
      { kind: 'platform' },
      user.id,
      meta.userAgent,
      days,
    );
    return { ...tokens, ...(trustedDevice ? { trustedDevice } : {}) };
  }

  async startMfaEmailCode(mfaToken: string): Promise<void> {
    const c = await this.tokens.verifyPlatformMfa(mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `platform:user:${c.platformUserId}`;
    await this.throttle.assertNotLocked('reset', key);
    await this.throttle.recordFailure('reset', key);
    if (!(await this.settings.getPlatform('platform.superAdminRecoveryEmail')))
      throw new ForbiddenException(
        'Signing in with an emailed code is turned off for platform staff',
      );
    const user = await this.user(c.platformUserId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    const code = await this.otp.issue('platform-mfa-signin', user.id, 600);
    await this.mail.send({
      event: 'platform.signin_code',
      to: user.email,
      subject: `Your ${this.config.APP_NAME} admin code: ${code}`,
      text: `Your one-time sign-in code is ${code}. It works once and expires in 10 minutes.\n\nIf you did not ask for it, change your password now.`,
    });
  }

  private static readonly SCOPE = { kind: 'platform' as const };

  /** Second step by passkey, after the password. */
  async mfaPasskeyOptions(mfaToken: string, rp: RelyingParty) {
    const c = await this.tokens.verifyPlatformMfa(mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    await this.throttle.assertNotLocked(
      'mfa',
      `platform:user:${c.platformUserId}`,
    );
    return this.passkeys.authenticationOptions(
      PlatformAuthService.SCOPE,
      rp,
      c.platformUserId,
    );
  }

  async verifyMfaPasskey(
    input: { mfaToken: string; response: AuthenticationResponseJSON },
    rp: RelyingParty,
    meta: { ip?: string; userAgent?: string },
  ): Promise<PlatformTokens> {
    const c = await this.tokens.verifyPlatformMfa(input.mfaToken);
    if (c.purpose !== 'mfa-verify')
      throw new UnauthorizedException('Invalid token');
    const key = `platform:user:${c.platformUserId}`;
    await this.throttle.assertNotLocked('mfa', key);
    try {
      const user = await this.user(c.platformUserId);
      if (user?.status !== 'ACTIVE') throw new UnauthorizedException();
      await this.passkeys.authenticationVerify(
        PlatformAuthService.SCOPE,
        input.response,
        rp,
        c.platformUserId,
      );
    } catch (e) {
      await this.throttle.recordFailure('mfa', key);
      throw e;
    }
    await this.throttle.clear('mfa', key);
    return this.startSession(c.platformUserId, meta);
  }

  /** Sign in with a passkey alone. */
  passkeyLoginOptions(rp: RelyingParty) {
    return this.passkeys.authenticationOptions(PlatformAuthService.SCOPE, rp);
  }

  async passkeyLogin(
    response: AuthenticationResponseJSON,
    rp: RelyingParty,
    meta: { ip?: string; userAgent?: string },
  ): Promise<PlatformTokens> {
    const key = `platform:ip:${meta.ip ?? 'unknown'}`;
    await this.throttle.assertNotLocked('login', key);
    try {
      const { userId } = await this.passkeys.authenticationVerify(
        PlatformAuthService.SCOPE,
        response,
        rp,
      );
      const user = await this.user(userId);
      if (user?.status !== 'ACTIVE')
        throw new UnauthorizedException('Passkey sign-in failed');
      await this.throttle.clear('login', key);
      await this.audit.record({
        actorId: userId,
        action: 'platform.login_passkey',
        entityType: 'platform_users',
        entityId: userId,
        ip: meta.ip,
      });
      return await this.startSession(userId, meta);
    } catch (e) {
      await this.throttle.recordFailure('login', key);
      throw e;
    }
  }

  async passkeyRegisterOptions(userId: string, rp: RelyingParty) {
    const user = await this.user(userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return this.passkeys.registrationOptions(
      PlatformAuthService.SCOPE,
      { id: user.id, email: user.email },
      rp,
    );
  }

  async passkeyRegisterVerify(
    userId: string,
    input: { response: RegistrationResponseJSON; label?: string },
    rp: RelyingParty,
    meta: { ip?: string; userAgent?: string },
  ) {
    const view = await this.passkeys.registrationVerify(
      PlatformAuthService.SCOPE,
      userId,
      input.response,
      rp,
      input.label,
      meta.userAgent,
    );
    await this.audit.record({
      actorId: userId,
      action: 'platform.passkey_added',
      entityType: 'platform_users',
      entityId: userId,
      meta: { label: view.label },
      ip: meta.ip,
    });
    return view;
  }

  async removePasskey(userId: string, id: string, ip?: string) {
    await this.passkeys.revoke(PlatformAuthService.SCOPE, userId, id);
    await this.audit.record({
      actorId: userId,
      action: 'platform.passkey_removed',
      entityType: 'platform_users',
      entityId: userId,
      ip,
    });
  }

  /** What My security shows for platform staff. */
  async securityInfo(userId: string) {
    const user = await this.user(userId);
    if (!user) throw new UnauthorizedException();
    return {
      mfaEnabled: Boolean(user.mfaEnabledAt),
      canDisableMfa:
        (await this.settings.getPlatform('platform.superAdminMfa')) !==
        'REQUIRED',
      emailFallback: await this.settings.getPlatform(
        'platform.superAdminRecoveryEmail',
      ),
      trustedDeviceDays: await this.settings.getPlatform(
        'platform.trustedDeviceDays',
      ),
      devices: await this.devices.list({ kind: 'platform' }, userId),
      passkeys: await this.passkeys.list({ kind: 'platform' }, userId),
    };
  }

  async revokeDevice(userId: string, id: string): Promise<void> {
    await this.devices.revoke({ kind: 'platform' }, userId, id);
    await this.audit.record({
      actorId: userId,
      action: 'platform.device_revoked',
      entityType: 'platform_users',
      entityId: userId,
    });
  }

  /** Turns off your own two-step (D-65): only where the platform policy is not REQUIRED, after the password. */
  async disableMfa(userId: string, password: string, ip?: string) {
    const user = await this.user(userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    if (
      (await this.settings.getPlatform('platform.superAdminMfa')) === 'REQUIRED'
    )
      throw new ForbiddenException(
        'Two-step is required for platform staff right now, so it cannot be turned off.',
      );
    if (!user.mfaEnabledAt)
      throw new ConflictException('Two-step is already off');
    const key = `stepup:platform:user:${user.id}`;
    await this.throttle.assertNotLocked('mfa', key);
    if (
      !user.passwordHash ||
      !(await this.passwords.verify(password, user.passwordHash))
    ) {
      await this.throttle.recordFailure('mfa', key);
      throw new UnauthorizedException('That password is not right');
    }
    await this.throttle.clear('mfa', key);
    await runAsSystem(async () => {
      await this.db().platformRecoveryCode.deleteMany({ where: { userId } });
      await this.db().platformUser.update({
        where: { id: userId },
        data: { mfaSecretEnc: null, mfaEnabledAt: null },
      });
    });
    await this.devices.revokeAll({ kind: 'platform' }, userId);
    await this.audit.record({
      actorId: userId,
      action: 'platform.mfa_disabled',
      entityType: 'platform_users',
      entityId: userId,
      meta: { by: 'self' },
      ip,
    });
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
      event: 'platform.recovery_code',
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
    return {
      id: u.id,
      email: u.email,
      mfaEnabled: Boolean(u.mfaEnabledAt),
      role: await this.roles.roleOf(u.id),
      permissions: [...(await this.roles.permissionsOf(u.id))].sort(),
    };
  }

  /** Creates or re-issues an invite. Returns the link so a CLI operator can hand it over. */
  async invite(
    email: string,
    actorId: string | null,
    /** Defaults to Owner, so the very first member of staff (set up from the command line) can do everything. */
    roleId: string = OWNER_ROLE_ID,
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
          await this.db().platformUser.create({
            data: { email: address, roleId },
          }),
      ));
    const token = randomBytes(32).toString('base64url');
    await this.redis.setJson(
      resetKey(token),
      { userId: user.id },
      7 * 24 * 3600,
    );
    const link = `${await this.runtime.require('ADMIN_URL')}/#/set-password?token=${token}`;
    let emailed = true;
    try {
      await this.mail.send({
        event: 'platform.invite',
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

  /** Emails a link to choose a password (reset: one hour, invite: seven days). Returns the link for the console. */
  async sendPasswordLink(
    userId: string,
    kind: 'reset' | 'invite',
  ): Promise<{ link: string; emailed: boolean }> {
    const user = await this.user(userId);
    if (!user) throw new NotFoundException();
    const token = randomBytes(32).toString('base64url');
    await this.redis.setJson(
      resetKey(token),
      { userId },
      kind === 'invite' ? 7 * 24 * 3600 : 3600,
    );
    const link = `${await this.runtime.require('ADMIN_URL')}/#/set-password?token=${token}`;
    let emailed = true;
    try {
      await this.mail.send({
        event:
          kind === 'invite' ? 'platform.invite' : 'platform.password_reset',
        to: user.email,
        subject:
          kind === 'invite'
            ? `You have been invited to the ${this.config.APP_NAME} admin console`
            : `Reset your ${this.config.APP_NAME} admin password`,
        text: `Choose a password (link valid for ${kind === 'invite' ? '7 days' : 'one hour'}):\n\n${link}\n\nIf you did not expect this, tell another administrator.`,
      });
    } catch {
      emailed = false;
    }
    return { link, emailed };
  }

  /** Ends every sign-in of a member of staff. */
  async revokeAllSessions(userId: string): Promise<void> {
    const ids = await runAsSystem(async () => {
      const open = await this.db().platformSession.findMany({
        where: { userId, revokedAt: null },
        select: { id: true },
      });
      await this.db().platformSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return open.map((s) => s.id);
    });
    await Promise.all(
      ids.map((id) =>
        this.redis.client.set(
          revokedKey(id),
          '1',
          'EX',
          this.config.ACCESS_TOKEN_TTL_SECONDS + 5,
        ),
      ),
    );
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
