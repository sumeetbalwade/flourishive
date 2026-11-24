import {
  loginBody,
  googleBody,
  mfaVerifyBody,
  mfaSetupBody,
  mfaConfirmBody,
  refreshBody,
  forgotBody,
  resetBody,
  recoveryVerifyBody,
  mfaRecoveryStartBody,
  mfaRecoveryVerifyBody,
  stepUpBody,
  mfaEmailCodeBody,
  mfaDisableBody,
  passkeyRegisterBody,
  passkeyLoginOptionsBody,
  passkeyLoginBody,
  mfaPasskeyBody,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import {
  AuthService,
  type LoginResult,
  type Principal,
} from './auth.service.js';
import { CurrentAuth, Public } from './auth.context.js';
import type { ClientMeta, IssuedTokens } from './session.service.js';
import { TokenService, type AccessClaims } from './token.service.js';
import { hostOfOrigin, slugFromOrigin } from '../company/tenant-host.js';
import { DomainsService } from '../domains/domains.service.js';
import { RequireStepUp, StepUpService } from './step-up.service.js';
import { relyingPartyFrom, type RelyingParty } from './passkey.service.js';
import { ZodPipe } from './zod.pipe.js';

const COOKIE = 'fh_refresh';
/** Holds the secret of a remembered device (D-64). httpOnly and SameSite=Strict. */
const DEVICE_COOKIE = 'fh_device';
const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeConfigService,
    private readonly stepUps: StepUpService,
    private readonly domains: DomainsService,
  ) {}

  /**
   * A browser on <company>.flourishive.in may only sign in to that company, so a page on one
   * company's address cannot be used to try another company's accounts. Other origins
   * (app., native apps, tools) name the company in the request body.
   */
  private async assertOrigin(req: Request, tenant: string): Promise<void> {
    const fromOrigin = slugFromOrigin(
      await this.runtime.require('TENANT_URL_TEMPLATE'),
      req.headers.origin,
    );
    if (fromOrigin && fromOrigin !== tenant.toLowerCase())
      throw new BadRequestException(
        'This sign-in page belongs to a different company',
      );
    // A company's own address (hr.company.com) is the same: it may only sign in to that company.
    const host = hostOfOrigin(req.headers.origin);
    if (!fromOrigin && host) {
      const custom = await this.domains.slugForHost(host);
      if (custom && custom !== tenant.toLowerCase())
        throw new BadRequestException(
          'This sign-in page belongs to a different company',
        );
    }
  }

  /** The site the browser is on. A passkey belongs to that host and works nowhere else. */
  private rp(req: Request): RelyingParty {
    const rp = relyingPartyFrom(req.headers.origin);
    if (!rp)
      throw new BadRequestException(
        'Passkeys need a browser on the sign-in page',
      );
    return rp;
  }

  private meta(req: Request): ClientMeta {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /** Native apps (desktop, mobile) get the refresh token in the body; browsers get an httpOnly cookie. */
  private respondTokens(req: Request, res: Response, t: IssuedTokens) {
    const native = req.headers['x-client'] === 'native';
    if (!native) {
      res.cookie(COOKIE, t.refreshToken, {
        httpOnly: true,
        secure: this.config.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/v1/auth',
        maxAge: t.refreshTtlMs,
      });
    }
    return {
      status: 'ok' as const,
      accessToken: t.accessToken,
      expiresIn: t.expiresIn,
      ...(native ? { refreshToken: t.refreshToken } : {}),
    };
  }

  /** Sets the remember-this-device cookie when the person ticked it. */
  private setDeviceCookie(
    res: Response,
    device?: { token: string; maxAgeMs: number },
  ) {
    if (!device) return;
    res.cookie(DEVICE_COOKIE, device.token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/v1/auth',
      maxAge: device.maxAgeMs,
    });
  }

  private respondLogin(req: Request, res: Response, r: LoginResult) {
    return r.status === 'ok' ? this.respondTokens(req, res, r.tokens) : r;
  }

  /** Principal from an MFA challenge token, or else from a normal Bearer access token. */
  private async principal(
    req: Request,
    mfaToken: string | undefined,
  ): Promise<{ who: Principal; viaChallenge: boolean }> {
    if (mfaToken)
      return {
        who: await this.auth.challengePrincipal(mfaToken, 'mfa-setup'),
        viaChallenge: true,
      };
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new UnauthorizedException();
    const c = await this.tokens.verifyAccess(h.slice(7));
    return {
      who: { tenantId: c.tenantId, userId: c.userId },
      viaChallenge: false,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(body(loginBody)) b: z.infer<typeof loginBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.assertOrigin(req, b.tenant);
    return this.respondLogin(
      req,
      res,
      await this.auth.login(b, this.meta(req), req.cookies?.[DEVICE_COOKIE]),
    );
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  async google(
    @Body(body(googleBody)) b: z.infer<typeof googleBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.assertOrigin(req, b.tenant);
    return this.respondLogin(
      req,
      res,
      await this.auth.loginWithGoogle(
        b,
        this.meta(req),
        req.cookies?.[DEVICE_COOKIE],
      ),
    );
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(
    @Body(body(mfaVerifyBody)) b: z.infer<typeof mfaVerifyBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { trustedDevice, ...tokens } = await this.auth.verifyMfa(
      b,
      this.meta(req),
    );
    this.setDeviceCookie(res, trustedDevice);
    return this.respondTokens(req, res, tokens);
  }

  /** "Email me a code instead", where the role's policy allows it. */
  @Public()
  @Post('mfa/email-code')
  @HttpCode(204)
  async mfaEmailCode(
    @Body(body(mfaEmailCodeBody)) b: z.infer<typeof mfaEmailCodeBody>,
    @Req() req: Request,
  ) {
    await this.auth.startMfaEmailCode(b.mfaToken, this.meta(req));
  }

  /** Second step by passkey, after the password. */
  @Public()
  @Post('mfa/passkey/options')
  @HttpCode(200)
  mfaPasskeyOptions(
    @Body(body(mfaEmailCodeBody)) b: z.infer<typeof mfaEmailCodeBody>,
    @Req() req: Request,
  ) {
    return this.auth.mfaPasskeyOptions(b.mfaToken, this.rp(req));
  }

  @Public()
  @Post('mfa/passkey/verify')
  @HttpCode(200)
  async mfaPasskeyVerify(
    @Body(body(mfaPasskeyBody)) b: z.infer<typeof mfaPasskeyBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondTokens(
      req,
      res,
      await this.auth.verifyMfaPasskey(
        b as never,
        this.rp(req),
        this.meta(req),
      ),
    );
  }

  /** Sign in with a passkey alone. */
  @Public()
  @Post('passkeys/login/options')
  @HttpCode(200)
  async passkeyLoginOptions(
    @Body(body(passkeyLoginOptionsBody))
    b: z.infer<typeof passkeyLoginOptionsBody>,
    @Req() req: Request,
  ) {
    await this.assertOrigin(req, b.tenant);
    return this.auth.passkeyLoginOptions(b.tenant, this.rp(req));
  }

  @Public()
  @Post('passkeys/login/verify')
  @HttpCode(200)
  async passkeyLogin(
    @Body(body(passkeyLoginBody)) b: z.infer<typeof passkeyLoginBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.assertOrigin(req, b.tenant);
    return this.respondTokens(
      req,
      res,
      await this.auth.passkeyLogin(b as never, this.rp(req), this.meta(req)),
    );
  }

  /** Add a passkey (needs a recent confirmation). */
  @RequireStepUp()
  @Post('passkeys/register/options')
  @HttpCode(200)
  passkeyRegisterOptions(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    return this.auth.passkeyRegisterOptions(a, this.rp(req));
  }

  @RequireStepUp()
  @Post('passkeys/register/verify')
  @HttpCode(200)
  passkeyRegisterVerify(
    @CurrentAuth() a: AccessClaims,
    @Body(body(passkeyRegisterBody)) b: z.infer<typeof passkeyRegisterBody>,
    @Req() req: Request,
  ) {
    return this.auth.passkeyRegisterVerify(
      a,
      b as never,
      this.rp(req),
      this.meta(req),
    );
  }

  @Delete('passkeys/:id')
  @HttpCode(204)
  async removePasskey(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.auth.removePasskey(a, id, this.meta(req));
  }

  /** My security: what is on, what may be turned off, remembered devices. */
  @Get('security')
  security(@CurrentAuth() a: AccessClaims) {
    return this.auth.securityInfo(a);
  }

  @Delete('trusted-devices/:id')
  @HttpCode(204)
  async revokeDevice(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    await this.auth.revokeDevice(a, id);
  }

  /** Turn off your own two-step (only where the policy is not REQUIRED). Needs the password again. */
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(
    @CurrentAuth() a: AccessClaims,
    @Body(body(mfaDisableBody)) b: z.infer<typeof mfaDisableBody>,
    @Req() req: Request,
  ) {
    await this.auth.disableMfa(a, b.password, this.meta(req));
  }

  @Public()
  @Post('mfa/setup')
  @HttpCode(200)
  async mfaSetup(
    @Body(body(mfaSetupBody)) b: z.infer<typeof mfaSetupBody>,
    @Req() req: Request,
  ) {
    const { who } = await this.principal(req, b.mfaToken);
    return this.auth.beginMfaSetup(who);
  }

  /** Returns recovery codes once. When enrolment was forced at login, also completes the sign-in. */
  @Public()
  @Post('mfa/confirm')
  @HttpCode(200)
  async mfaConfirm(
    @Body(body(mfaConfirmBody)) b: z.infer<typeof mfaConfirmBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { who, viaChallenge } = await this.principal(req, b.mfaToken);
    const { recoveryCodes } = await this.auth.confirmMfaSetup(who, b.code);
    if (!viaChallenge) return { recoveryCodes };
    return {
      recoveryCodes,
      ...this.respondTokens(
        req,
        res,
        await this.auth.startSession(who, this.meta(req)),
      ),
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(body(refreshBody)) b: z.infer<typeof refreshBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;
    const presented = cookies?.[COOKIE] ?? b.refreshToken;
    if (!presented) throw new UnauthorizedException('Missing refresh token');
    return this.respondTokens(
      req,
      res,
      await this.auth.refresh(presented, this.meta(req)),
    );
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() a: AccessClaims,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(a, a.sessionId);
    res.clearCookie(COOKIE, { path: '/v1/auth' });
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentAuth() a: AccessClaims,
    @Res({ passthrough: true }) res: Response,
  ) {
    const revoked = await this.auth.logoutEverywhere(a);
    res.clearCookie(COOKIE, { path: '/v1/auth' });
    return { revoked };
  }

  /** Confirm it is you before a sensitive action; lasts five minutes. */
  @Post('step-up')
  @HttpCode(204)
  async stepUp(
    @CurrentAuth() a: AccessClaims,
    @Body(body(stepUpBody)) b: z.infer<typeof stepUpBody>,
  ) {
    await this.stepUps.confirmTenant(a, b);
  }

  @Get('me')
  me(@CurrentAuth() a: AccessClaims) {
    return this.auth.me(a);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgot(
    @Body(body(forgotBody)) b: z.infer<typeof forgotBody>,
    @Req() req: Request,
  ) {
    await this.assertOrigin(req, b.tenant);
    await this.auth.forgotPassword(b, this.meta(req));
    return { status: 'accepted' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body(body(resetBody)) b: z.infer<typeof resetBody>) {
    await this.auth.resetPassword(b);
  }

  /** Forgot password by emailed code. Always 202, so it cannot be used to find accounts. */
  @Public()
  @Post('recovery/email')
  @HttpCode(202)
  async recoveryStart(
    @Body(body(forgotBody)) b: z.infer<typeof forgotBody>,
    @Req() req: Request,
  ) {
    await this.assertOrigin(req, b.tenant);
    await this.auth.startEmailRecovery(b, this.meta(req));
    return { status: 'accepted' };
  }

  @Public()
  @Post('recovery/email/verify')
  @HttpCode(200)
  async recoveryVerify(
    @Body(body(recoveryVerifyBody)) b: z.infer<typeof recoveryVerifyBody>,
    @Req() req: Request,
  ) {
    await this.assertOrigin(req, b.tenant);
    return this.auth.verifyEmailRecovery(b, this.meta(req));
  }

  /** Lost authenticator: emails a code to the account, after the password step. */
  @Public()
  @Post('mfa/recovery/email')
  @HttpCode(202)
  async mfaRecoveryStart(
    @Body(body(mfaRecoveryStartBody)) b: z.infer<typeof mfaRecoveryStartBody>,
    @Req() req: Request,
  ) {
    await this.auth.startMfaEmailRecovery(b.mfaToken, this.meta(req));
    return { status: 'accepted' };
  }

  @Public()
  @Post('mfa/recovery/email/verify')
  @HttpCode(200)
  mfaRecoveryVerify(
    @Body(body(mfaRecoveryVerifyBody))
    b: z.infer<typeof mfaRecoveryVerifyBody>,
    @Req() req: Request,
  ) {
    return this.auth.verifyMfaEmailRecovery(b, this.meta(req));
  }
}
