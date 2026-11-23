import { accountActionBody, accountAction } from '@flourishive/schemas';
import {
  BadRequestException,
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
import { RequirePermission } from '../access/require-permission.js';
import {
  AccountActionsService,
  type AccountAction,
} from '../identity/account-actions.service.js';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';
import { StaffActionsService } from './staff-actions.service.js';

const parseAction = (a: string): AccountAction => {
  const r = accountAction.safeParse(a);
  if (!r.success) throw new BadRequestException('Unknown action');
  return r.data;
};

/** Company side: a company admin looks after the accounts in their own company (D-63). */
@Controller('users')
export class TenantAccountsController {
  constructor(private readonly accounts: AccountActionsService) {}

  @RequirePermission('users.manage')
  @Get()
  list(@CurrentAuth() a: AccessClaims) {
    return this.accounts.list(a.tenantId);
  }

  @RequirePermission('users.manage')
  @Get(':id/account')
  async account(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.accounts.account(a.tenantId, id, {
      kind: 'tenant',
      userId: a.userId,
      label: '',
    });
  }

  @RequirePermission('users.manage')
  @RequireStepUp()
  @Post(':id/actions/:action')
  @HttpCode(200)
  async act(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body(new ZodPipe(accountActionBody)) b: z.infer<typeof accountActionBody>,
    @Req() req: Request,
  ) {
    return this.accounts.perform(
      a.tenantId,
      id,
      parseAction(action),
      b.reason,
      {
        kind: 'tenant',
        userId: a.userId,
        label: await this.accounts.tenantLabel(a.tenantId, a.userId),
      },
      req.ip,
    );
  }
}

/** Platform side: staff acting on a company's accounts, and on other staff (D-63, D-66). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformAccountsController {
  constructor(
    private readonly accounts: AccountActionsService,
    private readonly staff: StaffActionsService,
    private readonly prisma: PrismaService,
  ) {}

  private actor = (req: PlatformRequest) => req.platformAuth!.platformUserId;

  @RequirePlatformPermission('tenants.users.read')
  @Get('tenants/:tid/users')
  list(@Param('tid') tid: string) {
    return this.accounts.list(tid);
  }

  @RequirePlatformPermission('tenants.users.read')
  @Get('tenants/:tid/users/:id/account')
  async account(@Param('tid') tid: string, @Param('id') id: string, @Req() req: PlatformRequest) {
    const view = await this.accounts.account(tid, id);
    // Platform staff are not bound by the subset rule, but need the manage permission to act.
    return {
      ...view,
      allowed: req.platformAuth!.permissions.has('tenants.users.manage')
        ? view.allowed
        : [],
    };
  }

  @RequirePlatformPermission('tenants.users.manage')
  @RequireStepUp()
  @Post('tenants/:tid/users/:id/actions/:action')
  @HttpCode(200)
  async act(
    @Req() req: PlatformRequest,
    @Param('tid') tid: string,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body(new ZodPipe(accountActionBody)) b: z.infer<typeof accountActionBody>,
  ) {
    const me = await runAsSystem(
      async () =>
        await this.prisma.db.platformUser.findUnique({ where: { id: this.actor(req) } }),
    );
    return this.accounts.perform(
      tid,
      id,
      parseAction(action),
      b.reason,
      {
        kind: 'platform',
        staffId: this.actor(req),
        label: `Flourishive support (${me?.email ?? 'staff'})`,
      },
      req.ip,
    );
  }

  @RequirePlatformPermission('staff.manage')
  @Get('staff/:id/account')
  staffAccount(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.staff.account(this.actor(req), id);
  }

  @RequirePlatformPermission('staff.manage')
  @RequireStepUp()
  @Post('staff/:id/actions/:action')
  @HttpCode(200)
  staffAct(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body(new ZodPipe(accountActionBody)) b: z.infer<typeof accountActionBody>,
  ) {
    return this.staff.perform(this.actor(req), id, parseAction(action), b.reason, req.ip);
  }
}
