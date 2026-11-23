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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { ThrottleService } from '../identity/throttle.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformAuthService } from './platform-auth.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

/** Super admin: the platform's wording for every email, and which ones companies may change (D-59). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/mail/templates')
export class PlatformTemplatesController {
  constructor(
    private readonly templates: EmailTemplatesService,
    private readonly throttle: ThrottleService,
    private readonly auth: PlatformAuthService,
    private readonly audit: PlatformAuditService,
  ) {}

  private note(
    req: PlatformRequest,
    action: string,
    event: string,
    meta?: object,
  ) {
    return this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action,
      entityType: 'email_templates',
      meta: { event, ...meta },
      ip: req.ip,
    });
  }

  @RequirePlatformPermission('email.manage')
  @Get()
  async list() {
    return { items: await this.templates.list(null) };
  }

  @RequirePlatformPermission('email.manage')
  @Get(':event')
  get(@Param('event') event: string) {
    return this.templates.get(event, null);
  }

  @RequirePlatformPermission('email.manage')
  @Put(':event')
  async save(
    @Param('event') event: string,
    @Body(body(saveTemplateBody)) b: z.infer<typeof saveTemplateBody>,
    @Req() req: PlatformRequest,
  ) {
    const view = await this.templates.save(
      event,
      null,
      req.platformAuth!.platformUserId,
      b,
    );
    await this.note(req, 'platform.mail_template_saved', event, {
      locked: view.locked,
    });
    return view;
  }

  @RequirePlatformPermission('email.manage')
  @Delete(':event')
  async reset(@Param('event') event: string, @Req() req: PlatformRequest) {
    const view = await this.templates.reset(event, null);
    await this.note(req, 'platform.mail_template_reset', event);
    return view;
  }

  @RequirePlatformPermission('email.manage')
  @Post(':event/preview')
  @HttpCode(200)
  preview(
    @Param('event') event: string,
    @Body(body(previewTemplateBody)) b: z.infer<typeof previewTemplateBody>,
  ) {
    return this.templates.preview(event, null, b);
  }

  @RequirePlatformPermission('email.manage')
  @Post(':event/test')
  @HttpCode(204)
  async test(
    @Param('event') event: string,
    @Body(body(testTemplateBody)) b: z.infer<typeof testTemplateBody>,
    @Req() req: PlatformRequest,
  ) {
    const me = await this.auth.emailOfStaff(req.platformAuth!.platformUserId);
    if (!me) throw new UnauthorizedException();
    const key = `platform:${req.platformAuth!.platformUserId}`;
    await this.throttle.assertNotLocked('reset', key);
    await this.throttle.recordFailure('reset', key);
    await this.templates.sendTest(event, null, me, b);
  }
}
