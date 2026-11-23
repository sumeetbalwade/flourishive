import {
  platformLoginBody as loginBody,
  platformMfaVerifyBody as verifyBody,
  platformMfaSetupBody as setupBody,
  platformMfaConfirmBody as confirmBody,
  refreshBody,
  platformPasswordBody as passwordBody,
  platformRecoveryVerifyBody as recoveryBody,
  stepUpBody,
  mfaEmailCodeBody,
  mfaDisableBody,
  passkeyRegisterBody,
  mfaPasskeyBody,
  platformPasskeyLoginBody,
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
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { RequireStepUp, StepUpService } from '../identity/step-up.service.js';
import {
  relyingPartyFrom,
  type RelyingParty,
} from '../identity/passkey.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import {
  PlatformAuthService,
  type PlatformTokens,
} from './platform-auth.service.js';
import { PlatformGuard, type PlatformRequest } from './platform.guard.js';

const COOKIE = 'fh_platform_refresh';
const DEVICE_COOKIE = 'fh_platform_device';
const body = <T>(s: z.ZodType<T>) => new ZodPipe(s);

/** Super admin sign-in. Every route here is outside the tenant guard on purpose. */
@Public()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly stepUps: StepUpService,
    private readonly runtime: RuntimeConfigService,
  ) {}

  private meta = (req: Request) => ({
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  /** Staff passkeys belong to the admin site only, so the browser must be on the admin address. */
  private async rp(req: Request): Promise<RelyingParty> {
    const rp = relyingPartyFrom(req.headers.origin);
    const admin = relyingPartyFrom(await this.runtime.get('ADMIN_URL'));
    if (!rp || !admin || rp.origin !== admin.origin)
      throw new BadRequestException(
        'Passkeys work only on the admin sign-in page',
      );
    return rp;
  }

  private respond(req: Request, res: Response, t: PlatformTokens) {
    const native = req.headers['x-client'] === 'native';
    if (!native) {
      res.cookie(COOKIE, t.refreshToken, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'lax',
        path: '/v1/platform/auth',
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

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(body(loginBody)) b: z.infer<typeof loginBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(
      b,
      this.meta(req),
      req.cookies?.[DEVICE_COOKIE],
    );
    return r.status === 'ok' ? this.respond(req, res, r.tokens) : r;
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async verify(
    @Body(body(verifyBody)) b: z.infer<typeof verifyBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { trustedDevice, ...tokens } = await this.auth.verifyMfa(
      b,
      this.meta(req),
    );
    if (trustedDevice)
      res.cookie(DEVICE_COOKIE, trustedDevice.token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'strict',
        path: '/v1/platform/auth',
        maxAge: trustedDevice.maxAgeMs,
      });
    return this.respond(req, res, tokens);
  }

  @Post('mfa/passkey/options')
  @HttpCode(200)
  async mfaPasskeyOptions(
    @Body(body(mfaEmailCodeBody)) b: z.infer<typeof mfaEmailCodeBody>,
    @Req() req: Request,
  ) {
    return this.auth.mfaPasskeyOptions(b.mfaToken, await this.rp(req));
  }

  @Post('mfa/passkey/verify')
  @HttpCode(200)
  async mfaPasskeyVerify(
    @Body(body(mfaPasskeyBody)) b: z.infer<typeof mfaPasskeyBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      req,
      res,
      await this.auth.verifyMfaPasskey(
        b as never,
        await this.rp(req),
        this.meta(req),
      ),
    );
  }

  /** Sign in with a passkey alone. */
  @Post('passkeys/login/options')
  @HttpCode(200)
  async passkeyLoginOptions(@Req() req: Request) {
    return this.auth.passkeyLoginOptions(await this.rp(req));
  }

  @Post('passkeys/login/verify')
  @HttpCode(200)
  async passkeyLogin(
    @Body(body(platformPasskeyLoginBody))
    b: z.infer<typeof platformPasskeyLoginBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      req,
      res,
      await this.auth.passkeyLogin(
        b.response as never,
        await this.rp(req),
        this.meta(req),
      ),
    );
  }

  // Guards run bottom to top: sign-in first, then the recent-confirmation check.
  @RequireStepUp()
  @UseGuards(PlatformGuard)
  @Post('passkeys/register/options')
  @HttpCode(200)
  async passkeyRegisterOptions(@Req() req: PlatformRequest) {
    return this.auth.passkeyRegisterOptions(
      req.platformAuth!.platformUserId,
      await this.rp(req),
    );
  }

  // Guards run bottom to top: sign-in first, then the recent-confirmation check.
  @RequireStepUp()
  @UseGuards(PlatformGuard)
  @Post('passkeys/register/verify')
  @HttpCode(200)
  async passkeyRegisterVerify(
    @Req() req: PlatformRequest,
    @Body(body(passkeyRegisterBody)) b: z.infer<typeof passkeyRegisterBody>,
  ) {
    return this.auth.passkeyRegisterVerify(
      req.platformAuth!.platformUserId,
      b as never,
      await this.rp(req),
      this.meta(req),
    );
  }

  @UseGuards(PlatformGuard)
  @Delete('passkeys/:id')
  @HttpCode(204)
  async removePasskey(@Req() req: PlatformRequest, @Param('id') id: string) {
    await this.auth.removePasskey(req.platformAuth!.platformUserId, id, req.ip);
  }

  /** "Email me a code instead" (after the password step). */
  @Post('mfa/email-code')
  @HttpCode(204)
  async emailCode(
    @Body(body(mfaEmailCodeBody)) b: z.infer<typeof mfaEmailCodeBody>,
  ) {
    await this.auth.startMfaEmailCode(b.mfaToken);
  }

  /** My security: what is on, what may be turned off, remembered devices. */
  @UseGuards(PlatformGuard)
  @Get('security')
  security(@Req() req: PlatformRequest) {
    return this.auth.securityInfo(req.platformAuth!.platformUserId);
  }

  @UseGuards(PlatformGuard)
  @Delete('trusted-devices/:id')
  @HttpCode(204)
  async revokeDevice(@Req() req: PlatformRequest, @Param('id') id: string) {
    await this.auth.revokeDevice(req.platformAuth!.platformUserId, id);
  }

  /** Turn off your own two-step (only where the platform policy is not REQUIRED). Needs the password again. */
  @UseGuards(PlatformGuard)
  @Post('mfa/disable')
  @HttpCode(204)
  async disable(
    @Req() req: PlatformRequest,
    @Body(body(mfaDisableBody)) b: z.infer<typeof mfaDisableBody>,
  ) {
    await this.auth.disableMfa(
      req.platformAuth!.platformUserId,
      b.password,
      req.ip,
    );
  }

  /** Lost authenticator: emails a code (after the password step). */
  @Post('mfa/recovery/email')
  @HttpCode(202)
  async recoveryStart(@Body(body(setupBody)) b: z.infer<typeof setupBody>) {
    await this.auth.startMfaEmailRecovery(b.mfaToken);
    return { status: 'accepted' };
  }

  @Post('mfa/recovery/email/verify')
  @HttpCode(200)
  recoveryVerify(
    @Body(body(recoveryBody)) b: z.infer<typeof recoveryBody>,
    @Req() req: Request,
  ) {
    return this.auth.verifyMfaEmailRecovery(b, this.meta(req));
  }

  @Post('mfa/setup')
  @HttpCode(200)
  setup(@Body(body(setupBody)) b: z.infer<typeof setupBody>) {
    return this.auth.beginMfaSetup(b.mfaToken);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  async confirm(
    @Body(body(confirmBody)) b: z.infer<typeof confirmBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { recoveryCodes, tokens } = await this.auth.confirmMfaSetup(
      b.mfaToken,
      b.code,
      this.meta(req),
    );
    return { recoveryCodes, ...this.respond(req, res, tokens) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(body(refreshBody)) b: z.infer<typeof refreshBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented =
      (req as Request & { cookies?: Record<string, string> }).cookies?.[
        COOKIE
      ] ?? b.refreshToken;
    if (!presented) throw new UnauthorizedException('Missing refresh token');
    return this.respond(req, res, await this.auth.refresh(presented));
  }

  @Post('set-password')
  @HttpCode(204)
  async setPassword(@Body(body(passwordBody)) b: z.infer<typeof passwordBody>) {
    await this.auth.setPassword(b.token, b.password);
  }

  @UseGuards(PlatformGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: PlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.revokeSession(req.platformAuth!.sessionId);
    res.clearCookie(COOKIE, { path: '/v1/platform/auth' });
  }

  /** Confirm it is you before a sensitive action; lasts five minutes. */
  @UseGuards(PlatformGuard)
  @Post('step-up')
  @HttpCode(204)
  async stepUp(
    @Req() req: PlatformRequest,
    @Body(body(stepUpBody)) b: z.infer<typeof stepUpBody>,
  ) {
    await this.stepUps.confirmPlatform(req.platformAuth!, b);
  }

  @UseGuards(PlatformGuard)
  @Get('me')
  me(@Req() req: PlatformRequest) {
    return this.auth.me(req.platformAuth!.platformUserId);
  }
}
