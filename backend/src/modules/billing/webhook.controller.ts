import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../identity/auth.context.js';
import { CheckoutService } from './checkout.service.js';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './gateway/payment-gateway.js';

/** The provider's webhooks. Open to the internet, so everything depends on the signature (D-21). */
@Public()
@Controller('webhooks')
export class BillingWebhookController {
  constructor(
    private readonly checkout: CheckoutService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @HttpCode(200)
  @Post('razorpay')
  async razorpay(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    const raw = req.rawBody;
    if (
      !raw ||
      !signature ||
      !(await this.gateway.verifyWebhook(raw, signature))
    )
      throw new BadRequestException('Invalid signature');
    if (!eventId) throw new BadRequestException('Missing event id');
    const handled = await this.checkout.handleWebhook(
      eventId,
      JSON.parse(raw.toString('utf8')),
    );
    return { received: true, duplicate: !handled };
  }
}
