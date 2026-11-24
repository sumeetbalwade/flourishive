import {
  billingProfileBody,
  type BillingProfileBody,
  checkoutBody,
  confirmBody,
  type CheckoutBody,
  type ConfirmBody,
} from '@flourishive/schemas';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { InvoiceService } from './invoice.service.js';
import { CheckoutService } from './checkout.service.js';
import { LimitsService } from './limits.service.js';
import { PlansService } from './plans.service.js';

/** Company side: the plan, what it allows, what has been used, and paying for a plan. */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly limits: LimitsService,
    private readonly plans: PlansService,
    private readonly checkout: CheckoutService,
    private readonly invoices: InvoiceService,
  ) {}

  @Get('plan')
  plan(@CurrentAuth() a: AccessClaims) {
    return this.limits.view(a.tenantId);
  }

  @Get('plans')
  catalogue() {
    return this.plans.catalogue();
  }

  @Get('state')
  state(@CurrentAuth() a: AccessClaims) {
    return this.checkout.state(a.tenantId);
  }

  @RequirePermission('settings.read')
  @Get('profile')
  async profile(@CurrentAuth() a: AccessClaims) {
    return (await this.invoices.profile(a.tenantId)) ?? null;
  }

  @RequirePermission('settings.manage')
  @Put('profile')
  saveProfile(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(billingProfileBody)) b: BillingProfileBody,
  ) {
    return this.invoices.saveProfile(a.tenantId, b);
  }

  @RequirePermission('settings.read')
  @Get('invoices')
  listInvoices(@CurrentAuth() a: AccessClaims) {
    return this.invoices.list(a.tenantId);
  }

  @RequirePermission('settings.read')
  @Get('invoices/:id/link')
  invoiceLink(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.invoices.link(a.tenantId, id);
  }

  @RequirePermission('settings.manage')
  @Post('checkout')
  start(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(checkoutBody)) b: CheckoutBody,
  ) {
    return this.checkout.checkout(a.tenantId, b);
  }

  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('confirm')
  confirm(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(confirmBody)) b: ConfirmBody,
  ) {
    return this.checkout.confirm(a.tenantId, b);
  }

  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('cancel')
  cancel(@CurrentAuth() a: AccessClaims) {
    return this.checkout.cancel(a.tenantId);
  }
}
