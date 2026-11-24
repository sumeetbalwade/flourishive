import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { LimitsService } from './limits.service.js';
import { PlansService } from './plans.service.js';

/** Plans and limits (D-20). Global so any module can check a limit before it adds something. */
@Global()
@Module({
  controllers: [BillingController],
  providers: [LimitsService, PlansService],
  exports: [LimitsService, PlansService],
})
export class BillingModule {}
