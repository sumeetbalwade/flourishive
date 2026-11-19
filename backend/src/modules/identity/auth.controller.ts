import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import {
  AuthService,
  type LoginResult,
  type Principal,
} from './auth.service.js';
import { CurrentAuth, Public } from './auth.context.js';
import type { ClientMeta, IssuedTokens } from './session.service.js';
import { TokenService, type AccessClaims } from './token.service.js';
import { ZodPipe } from './zod.pipe.js';

const COOKIE = 'fh_refresh';
const tenant = z.string().min(1).max(63);
const email = z.string().email().max(191);

const loginBody = z.object({
  tenant,
  email,
  password: z.string().min(1).max(256),
});
const googleBody = z.object({ tenant, idToken: z.string().min(1) });
const mfaVerifyBody = z
  .object({
    mfaToken: z.string(),
    code: z.string().optional(),
    recoveryCode: z.string().optional(),
  })
  .refine((b) => b.code || b.recoveryCode, 'code or recoveryCode is required');
const mfaSetupBody = z.object({ mfaToken: z.string().optional() });
const mfaConfirmBody = z.object({
  mfaToken: z.string().optional(),
  code: z.string().regex(/^\d{6}$/),
});
const refreshBody = z
  .object({ refreshToken: z.string().optional() })
  .default({});
const forgotBody = z.object({ tenant, email });
const resetBody = z.object({
  token: z.string().min(1),
  password: z.string().min(1).max(256),
});

const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

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
        maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
      });
    }
    return {
      status: 'ok' as const,
      accessToken: t.accessToken,
      expiresIn: t.expiresIn,
      ...(native ? { refreshToken: t.refreshToken } : {}),
    };
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
    return this.respondLogin(
      req,
      res,
      await this.auth.login(b, this.meta(req)),
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
    return this.respondLogin(
      req,
      res,
      await this.auth.loginWithGoogle(b, this.meta(req)),
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
    return this.respondTokens(
      req,
      res,
      await this.auth.verifyMfa(b, this.meta(req)),
    );
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
    return this.respondTokens(req, res, await this.auth.refresh(presented));
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
    await this.auth.forgotPassword(b, this.meta(req));
    return { status: 'accepted' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body(body(resetBody)) b: z.infer<typeof resetBody>) {
    await this.auth.resetPassword(b);
  }
}
