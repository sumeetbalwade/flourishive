import { ssoConfigBody, type SsoConfigBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth, Public } from './auth.context.js';
import { SsoService } from './sso.service.js';
import type { AccessClaims } from './token.service.js';
import { ZodPipe } from './zod.pipe.js';

/** Single sign-on: the company's connection settings, and the browser round trip (D-16). */
@Controller()
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @RequirePermission('settings.read')
  @Get('sso/config')
  async config(@CurrentAuth() a: AccessClaims) {
    return (await this.sso.view(a.tenantId)) ?? null;
  }

  @RequirePermission('settings.manage')
  @Put('sso/config')
  save(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(ssoConfigBody)) b: SsoConfigBody,
  ) {
    return this.sso.save(a.tenantId, b, a.userId);
  }

  @RequirePermission('settings.manage')
  @HttpCode(204)
  @Delete('sso/config')
  remove(@CurrentAuth() a: AccessClaims) {
    return this.sso.remove(a.tenantId);
  }

  @Public()
  @Get('auth/sso/options')
  options(@Query('tenant') tenant = '') {
    return this.sso.options(tenant);
  }

  @Public()
  @HttpCode(200)
  @Post('auth/sso/start')
  start(
    @Body(new ZodPipe(z.object({ tenant: z.string().min(1).max(63) })))
    b: {
      tenant: string;
    },
  ) {
    return this.sso.start(b.tenant);
  }

  /** The provider sends the browser here. It always ends in a redirect back to the company's sign-in page. */
  @Public()
  @Get('auth/sso/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const r = await this.sso.callback(code ?? '', state ?? '');
    const base = r.slug ? await this.sso.webUrl(r.slug) : '';
    const hash = r.ticket
      ? `#/sso?ticket=${encodeURIComponent(r.ticket)}`
      : `#/login?sso_error=${encodeURIComponent(r.error ?? 'Sign-in failed')}`;
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, `${base}/${hash}`);
  }
}
