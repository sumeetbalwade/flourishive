import { Controller, Get } from '@nestjs/common';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { LimitsService } from './limits.service.js';
import { PlansService } from './plans.service.js';

/** Company side: the plan, what it allows and what has been used. */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly limits: LimitsService,
    private readonly plans: PlansService,
  ) {}

  @Get('plan')
  plan(@CurrentAuth() a: AccessClaims) {
    return this.limits.view(a.tenantId);
  }

  @Get('plans')
  catalogue() {
    return this.plans.catalogue();
  }
}
