import { startSupportBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import type { AccessClaims } from '../identity/token.service.js';
import { RequirePermission } from '../access/require-permission.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';
import { SupportSessionsService } from './support-sessions.service.js';

/** Staff side: open, list and end support sessions (D-56). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformSupportController {
  constructor(private readonly support: SupportSessionsService) {}

  private actor = (req: PlatformRequest) => req.platformAuth!.platformUserId;

  // Either permission opens the route; the service checks the one the chosen mode needs.
  @RequirePlatformPermission('tenants.data.read', 'tenants.data.write')
  @RequireStepUp()
  @Post('tenants/:id/support-sessions')
  @HttpCode(201)
  start(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(startSupportBody)) b: z.infer<typeof startSupportBody>,
  ) {
    return this.support.start(this.actor(req), id, b, req.ip);
  }

  @RequirePlatformPermission('tenants.read')
  @Get('tenants/:id/support-sessions')
  list(@Param('id') id: string) {
    return this.support.listFor(id, false);
  }

  @RequirePlatformPermission(
    'tenants.data.read',
    'tenants.data.write',
    'staff.manage',
  )
  @Post('support-sessions/:id/end')
  @HttpCode(204)
  end(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.support.endByStaff(this.actor(req), id, req.ip);
  }
}

/** Company side: see who looked at the company, and end the session you are in or one you see. */
@Controller('support')
export class TenantSupportController {
  constructor(private readonly support: SupportSessionsService) {}

  @RequirePermission('audit.read')
  @Get('sessions')
  list(@CurrentAuth() a: AccessClaims) {
    return this.support.listFor(a.tenantId, true);
  }

  /** The banner's "End session": a support principal ends its own session. */
  @Post('sessions/current/end')
  @HttpCode(204)
  endCurrent(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    if (!a.support) return;
    return this.support.endByCompany(a.tenantId, a.sessionId, req.ip);
  }

  /** A company admin ends any session on their company. */
  @RequirePermission('settings.manage')
  @Post('sessions/:id/end')
  @HttpCode(204)
  end(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.support.endByCompany(a.tenantId, id, req.ip);
  }
}
