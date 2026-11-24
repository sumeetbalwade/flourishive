import { brandPatch, saveBrandDraftBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { BrandService } from '../brand/brand.service.js';
import { Public } from '../identity/auth.context.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

/** Super admin: the product's own brand (name, colours, sign-in text, links), live without a deploy (D-62). */
const previewBody = z.object({
  draft: brandPatch,
  scheme: z.enum(['light', 'dark']).default('light'),
});

@Public()
@UseGuards(PlatformGuard)
@Controller('platform/brand')
export class PlatformBrandController {
  constructor(
    private readonly brand: BrandService,
    private readonly audit: PlatformAuditService,
    private readonly templates: EmailTemplatesService,
  ) {}

  private note(
    req: PlatformRequest,
    action: string,
    meta?: Record<string, unknown>,
  ) {
    return this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action,
      entityType: 'brand_profiles',
      ...(meta ? { meta } : {}),
      ip: req.ip,
    });
  }

  @RequirePlatformPermission('brand.manage')
  @Get()
  state() {
    return this.brand.state(null);
  }

  @RequirePlatformPermission('brand.manage')
  @Put('draft')
  async save(
    @Body(new ZodPipe(saveBrandDraftBody))
    b: z.infer<typeof saveBrandDraftBody>,
    @Req() req: PlatformRequest,
  ) {
    const s = await this.brand.saveDraft(
      null,
      req.platformAuth!.platformUserId,
      b.draft,
    );
    await this.note(req, 'platform.brand_draft_saved');
    return s;
  }

  @RequirePlatformPermission('brand.manage')
  @Delete('draft')
  async discard(@Req() req: PlatformRequest) {
    const s = await this.brand.discardDraft(null);
    await this.note(req, 'platform.brand_draft_discarded');
    return s;
  }

  @RequirePlatformPermission('brand.manage')
  @Post('preview/email')
  @HttpCode(200)
  async previewEmail(
    @Body(new ZodPipe(previewBody)) b: z.infer<typeof previewBody>,
  ) {
    return this.templates.preview(
      'auth.invite',
      null,
      { scheme: b.scheme },
      await this.brand.withDraft(null, b.draft),
    );
  }

  @RequirePlatformPermission('brand.manage')
  @Post('publish')
  @HttpCode(200)
  async publish(@Req() req: PlatformRequest) {
    const s = await this.brand.publish(null, req.platformAuth!.platformUserId);
    await this.note(req, 'platform.brand_published', {
      version: s.publishedVersion,
    });
    return s;
  }

  @RequirePlatformPermission('brand.manage')
  @Post('revert')
  @HttpCode(200)
  async revert(@Req() req: PlatformRequest) {
    const s = await this.brand.revert(null, req.platformAuth!.platformUserId);
    await this.note(req, 'platform.brand_reverted', {
      version: s.publishedVersion,
    });
    return s;
  }
}
