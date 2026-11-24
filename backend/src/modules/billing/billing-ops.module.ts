import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FilesModule } from '../files/files.module.js';
import { BillingStatusGuard } from './billing-status.guard.js';
import { BillingController } from './billing.controller.js';
import { CheckoutService } from './checkout.service.js';
import { DunningService } from './dunning.service.js';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.js';
import { RazorpayGateway } from './gateway/razorpay.gateway.js';
import { OverviewService } from './overview.service.js';
import { InvoiceService } from './invoice.service.js';
import { BillingWebhookController } from './webhook.controller.js';

/** Paid subscriptions, invoices, webhooks and dunning (D-21). */
@Module({
  imports: [FilesModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    CheckoutService,
    InvoiceService,
    DunningService,
    OverviewService,
    { provide: APP_GUARD, useClass: BillingStatusGuard },
    { provide: PAYMENT_GATEWAY, useClass: RazorpayGateway },
  ],
  exports: [
    CheckoutService,
    InvoiceService,
    DunningService,
    OverviewService,
    PAYMENT_GATEWAY,
  ],
})
export class BillingOpsModule {}
