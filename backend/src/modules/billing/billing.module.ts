import { Global, Module } from '@nestjs/common';
import { LimitsService } from './limits.service.js';
import { PlansService } from './plans.service.js';

/**
 * Plans and limits (D-20). Global and free of other modules, so files, people and signing can all
 * check a limit without a module cycle. Payments, invoices and reminders are in BillingOpsModule.
 */
@Global()
@Module({
  providers: [LimitsService, PlansService],
  exports: [LimitsService, PlansService],
})
export class BillingModule {}
