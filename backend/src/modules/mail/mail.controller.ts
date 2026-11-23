import {
  confirmSenderCodeBody,
  deliveryQuery,
  dnsCheckBody,
  saveSenderBody,
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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { MailDeliveriesService } from './mail-deliveries.service.js';
import { MailSenderService } from './mail-sender.service.js';

const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

/** Company side: who this company's email comes from, and the email log (D-58, D-60). */
@Controller('mail')
export class MailController {
  constructor(
    private readonly senders: MailSenderService,
    private readonly deliveries: MailDeliveriesService,
    private readonly audit: AuditService,
  ) {}

  private note(
    a: AccessClaims,
    action: string,
    req: Request,
    meta?: Record<string, unknown>,
  ) {
    return this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action,
      entityType: 'mail_senders',
      entityId: null,
      meta: meta ?? null,
      ip: req.ip,
    });
  }

  @RequirePermission('email.manage')
  @Get('sender')
  state(@CurrentAuth() a: AccessClaims) {
    return this.senders.state(a.tenantId);
  }

  @RequirePermission('email.manage')
  @RequireStepUp()
  @Put('sender')
  async save(
    @CurrentAuth() a: AccessClaims,
    @Body(body(saveSenderBody)) b: z.infer<typeof saveSenderBody>,
    @Req() req: Request,
  ) {
    const view = await this.senders.save(a.tenantId, b);
    await this.note(a, 'mail.sender_saved', req, {
      kind: b.kind,
      from: b.fromAddress,
    });
    return view;
  }

  @RequirePermission('email.manage')
  @Post('sender/verify/start')
  @HttpCode(204)
  async start(@CurrentAuth() a: AccessClaims) {
    await this.senders.startVerify(a.tenantId);
  }

  @RequirePermission('email.manage')
  @Post('sender/verify/confirm')
  @HttpCode(200)
  confirm(
    @CurrentAuth() a: AccessClaims,
    @Body(body(confirmSenderCodeBody)) b: z.infer<typeof confirmSenderCodeBody>,
  ) {
    return this.senders.confirmCode(a.tenantId, b.code);
  }

  @RequirePermission('email.manage')
  @Post('sender/test')
  @HttpCode(200)
  async test(@CurrentAuth() a: AccessClaims) {
    return this.senders.test(
      a.tenantId,
      await this.senders.emailOf(a.tenantId, a.userId),
    );
  }

  @RequirePermission('email.manage')
  @Post('sender/dns')
  @HttpCode(200)
  dns(
    @CurrentAuth() a: AccessClaims,
    @Body(body(dnsCheckBody)) b: z.infer<typeof dnsCheckBody>,
  ) {
    return this.senders.dns(a.tenantId, b.dkimSelector);
  }

  @RequirePermission('email.manage')
  @RequireStepUp()
  @Post('sender/activate')
  @HttpCode(200)
  async activate(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    const view = await this.senders.activate(a.tenantId);
    await this.note(a, 'mail.sender_activated', req, {
      from: view.fromAddress,
    });
    return view;
  }

  @RequirePermission('email.manage')
  @Delete('sender')
  @HttpCode(204)
  async remove(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    await this.senders.remove(a.tenantId);
    await this.note(a, 'mail.sender_removed', req);
  }

  @RequirePermission('email.manage')
  @Get('deliveries')
  list(
    @CurrentAuth() a: AccessClaims,
    @Query(body(deliveryQuery)) q: z.infer<typeof deliveryQuery>,
  ) {
    return this.deliveries.list(q, a.tenantId);
  }

  @RequirePermission('email.manage')
  @Post('deliveries/:id/resend')
  @HttpCode(204)
  async resend(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    await this.deliveries.resend(id, a.tenantId);
  }
}
