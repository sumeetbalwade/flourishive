import {
  previewTemplateBody,
  saveTemplateBody,
  testTemplateBody,
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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ThrottleService } from '../identity/throttle.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { MailSenderService } from './mail-sender.service.js';

const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

/** Company side: reword the emails the company sends (D-59). */
@Controller('mail/templates')
export class MailTemplatesController {
  constructor(
    private readonly templates: EmailTemplatesService,
    private readonly senders: MailSenderService,
    private readonly throttle: ThrottleService,
    private readonly audit: AuditService,
  ) {}

  private note(a: AccessClaims, action: string, event: string, req: Request) {
    // Only which email changed: never the wording itself.
    return this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action,
      entityType: 'email_templates',
      entityId: null,
      meta: { event },
      ip: req.ip,
    });
  }

  @RequirePermission('email.manage')
  @Get()
  async list(@CurrentAuth() a: AccessClaims) {
    return { items: await this.templates.list(a.tenantId) };
  }

  @RequirePermission('email.manage')
  @Get(':event')
  get(@CurrentAuth() a: AccessClaims, @Param('event') event: string) {
    return this.templates.get(event, a.tenantId);
  }

  @RequirePermission('email.manage')
  @Put(':event')
  async save(
    @CurrentAuth() a: AccessClaims,
    @Param('event') event: string,
    @Body(body(saveTemplateBody)) b: z.infer<typeof saveTemplateBody>,
    @Req() req: Request,
  ) {
    const view = await this.templates.save(event, a.tenantId, a.userId, {
      subject: b.subject,
      body: b.body,
    });
    await this.note(a, 'mail.template_saved', event, req);
    return view;
  }

  @RequirePermission('email.manage')
  @Delete(':event')
  async reset(
    @CurrentAuth() a: AccessClaims,
    @Param('event') event: string,
    @Req() req: Request,
  ) {
    const view = await this.templates.reset(event, a.tenantId);
    await this.note(a, 'mail.template_reset', event, req);
    return view;
  }

  @RequirePermission('email.manage')
  @Post(':event/preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() a: AccessClaims,
    @Param('event') event: string,
    @Body(body(previewTemplateBody)) b: z.infer<typeof previewTemplateBody>,
  ) {
    return this.templates.preview(event, a.tenantId, b);
  }

  @RequirePermission('email.manage')
  @Post(':event/test')
  @HttpCode(204)
  async test(
    @CurrentAuth() a: AccessClaims,
    @Param('event') event: string,
    @Body(body(testTemplateBody)) b: z.infer<typeof testTemplateBody>,
  ) {
    // Sends mail, so it is rate-limited like the other mail-sending actions.
    const key = `${a.tenantId}:${a.userId}`;
    await this.throttle.assertNotLocked('reset', key);
    await this.throttle.recordFailure('reset', key);
    await this.templates.sendTest(
      event,
      a.tenantId,
      await this.senders.emailOf(a.tenantId, a.userId),
      b,
    );
  }
}
