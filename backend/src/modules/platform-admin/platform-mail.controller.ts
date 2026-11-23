import { deliveryQuery } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { MailDeliveriesService } from '../mail/mail-deliveries.service.js';
import { MailSenderService } from '../mail/mail-sender.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

/** Super admin: the email log across companies, and each company's sender (D-58, D-60). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/mail')
export class PlatformMailController {
  constructor(
    private readonly deliveries: MailDeliveriesService,
    private readonly senders: MailSenderService,
    private readonly audit: PlatformAuditService,
  ) {}

  @RequirePlatformPermission('email.manage')
  @Get('deliveries')
  list(@Query(new ZodPipe(deliveryQuery)) q: z.infer<typeof deliveryQuery>) {
    return this.deliveries.list(q, null);
  }

  @RequirePlatformPermission('email.manage')
  @Post('deliveries/:id/resend')
  @HttpCode(204)
  async resend(@Param('id') id: string) {
    await this.deliveries.resend(id, null);
  }

  @RequirePlatformPermission('email.manage')
  @Get('tenants/:tid/sender')
  state(@Param('tid') tid: string) {
    return this.senders.state(tid);
  }

  /** Puts a company back on the platform's default sender (for example when theirs is broken). */
  @RequirePlatformPermission('email.manage')
  @RequireStepUp()
  @Delete('tenants/:tid/sender')
  @HttpCode(204)
  async remove(@Param('tid') tid: string, @Req() req: PlatformRequest) {
    await this.senders.remove(tid);
    await this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action: 'platform.mail_sender_removed',
      entityType: 'tenants',
      entityId: tid,
      tenantId: tid,
      ip: req.ip,
    });
  }
}
