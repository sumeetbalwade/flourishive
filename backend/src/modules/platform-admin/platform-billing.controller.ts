import {
  assignPlanBody,
  planBody,
  type AssignPlanBody,
  type PlanBody,
} from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../identity/auth.context.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { LimitsService } from '../billing/limits.service.js';
import { PlansService } from '../billing/plans.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

/** Super admin: plans, limits, and which company is on which plan (D-20). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformBillingController {
  constructor(
    private readonly plans: PlansService,
    private readonly limits: LimitsService,
    private readonly audit: PlatformAuditService,
  ) {}

  private note(
    req: PlatformRequest,
    action: string,
    meta?: Record<string, unknown>,
    tenantId?: string,
  ) {
    return this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action,
      entityType: 'plans',
      meta,
      ip: req.ip,
      tenantId,
    });
  }

  @RequirePlatformPermission('tenants.read')
  @Get('plans')
  list() {
    return this.plans.list();
  }

  @RequirePlatformPermission('billing.manage')
  @Post('plans')
  async create(
    @Body(new ZodPipe(planBody)) b: PlanBody,
    @Req() req: PlatformRequest,
  ) {
    const p = await this.plans.create(b);
    await this.note(req, 'platform.plan_created', { key: b.key });
    return p;
  }

  @RequirePlatformPermission('billing.manage')
  @Put('plans/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodPipe(planBody)) b: PlanBody,
    @Req() req: PlatformRequest,
  ) {
    const p = await this.plans.update(id, b);
    await this.note(req, 'platform.plan_changed', {
      key: b.key,
      limits: b.limits,
    });
    return p;
  }

  @RequirePlatformPermission('billing.manage')
  @Delete('plans/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: PlatformRequest) {
    await this.plans.remove(id);
    await this.note(req, 'platform.plan_removed', { id });
  }

  @RequirePlatformPermission('tenants.read')
  @Get('tenants/:id/subscription')
  subscription(@Param('id') id: string) {
    return this.limits.view(id);
  }

  @RequirePlatformPermission('billing.manage')
  @Put('tenants/:id/subscription')
  async assign(
    @Param('id') id: string,
    @Body(new ZodPipe(assignPlanBody)) b: AssignPlanBody,
    @Req() req: PlatformRequest,
  ) {
    await this.plans.assign(id, b, req.platformAuth!.platformUserId);
    await this.note(
      req,
      'platform.subscription_changed',
      { planId: b.planId, status: b.status, overrides: b.limitOverrides },
      id,
    );
    return this.limits.view(id);
  }
}
