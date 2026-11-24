import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { CheckoutService } from './checkout.service.js';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.js';
import { RazorpayGateway } from './gateway/razorpay.gateway.js';
import { LimitsService } from './limits.service.js';
import { PlansService } from './plans.service.js';
import { BillingWebhookController } from './webhook.controller.js';

/** Plans, limits and paid subscriptions (D-20, D-21). Global so any module can check a limit. */
@Global()
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [
    LimitsService,
    PlansService,
    CheckoutService,
    { provide: PAYMENT_GATEWAY, useClass: RazorpayGateway },
  ],
  exports: [LimitsService, PlansService, CheckoutService, PAYMENT_GATEWAY],
})
export class BillingModule {}
