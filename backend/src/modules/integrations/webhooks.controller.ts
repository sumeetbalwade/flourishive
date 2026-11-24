import { webhookBody, type WebhookBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { WebhooksService } from './webhooks.service.js';

/** Company side: where events are sent, and the log of what was sent. */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly hooks: WebhooksService) {}

  @RequirePermission('settings.read')
  @Get()
  list(@CurrentAuth() a: AccessClaims) {
    return this.hooks.list(a.tenantId);
  }

  @RequirePermission('settings.manage')
  @RequireStepUp()
  @Post()
  create(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(webhookBody)) b: WebhookBody,
  ) {
    return this.hooks.create(a.tenantId, a.userId, b);
  }

  @RequirePermission('settings.manage')
  @Put(':id')
  update(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body(new ZodPipe(webhookBody)) b: WebhookBody,
  ) {
    return this.hooks.update(a.tenantId, id, b);
  }

  @RequirePermission('settings.manage')
  @RequireStepUp()
  @HttpCode(200)
  @Post(':id/rotate')
  rotate(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.hooks.rotate(a.tenantId, id);
  }

  @RequirePermission('settings.manage')
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.hooks.remove(a.tenantId, id);
  }

  @RequirePermission('settings.read')
  @Get(':id/deliveries')
  deliveries(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.hooks.deliveries(a.tenantId, id);
  }

  @RequirePermission('settings.manage')
  @HttpCode(204)
  @Post(':id/test')
  test(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.hooks.ping(a.tenantId, id);
  }

  @RequirePermission('settings.manage')
  @HttpCode(204)
  @Post('deliveries/:deliveryId/resend')
  resend(
    @CurrentAuth() a: AccessClaims,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.hooks.resend(a.tenantId, deliveryId);
  }
}
