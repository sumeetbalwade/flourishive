import {
  brandPatch,
  saveBrandDraftBody,
  uploadAssetQuery,
} from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { BrandAssetsService } from './brand-assets.service.js';
import { BrandService } from './brand.service.js';

const previewBody = z.object({
  draft: brandPatch,
  scheme: z.enum(['light', 'dark']).default('light'),
});

const FIVE_MINUTES = 'public, max-age=300';

/** Open: the brand the sign-in pages and every app load first. Express adds the ETag. */
@Public()
@Controller('public')
export class PublicBrandController {
  constructor(
    private readonly brand: BrandService,
    private readonly assets: BrandAssetsService,
  ) {}

  /** A favicon as .ico, for browsers that ask for one. */
  @Get('brand-assets/:id/favicon.ico')
  async ico(@Param('id') id: string, @Res() res: Response) {
    const body = await this.assets.ico(id);
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(body);
  }

  /** A brand picture. Served inline but sandboxed, so even a hostile file could not run anything. */
  @Get('brand-assets/:id')
  async asset(@Param('id') id: string, @Res() res: Response) {
    const { row, stream } = await this.assets.open(id);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    stream.pipe(res);
  }

  @Get('brand')
  async product(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', FIVE_MINUTES);
    return this.brand.effective(null);
  }

  @Get('company/:slug/brand')
  async company(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const b = await this.brand.bySlug(slug);
    if (!b) throw new NotFoundException('Company not found');
    res.setHeader('Cache-Control', FIVE_MINUTES);
    return b;
  }
}

/** Company side: edit a draft, preview, publish, go back (D-61). */
@Controller('brand')
export class BrandController {
  constructor(
    private readonly brand: BrandService,
    private readonly audit: AuditService,
    private readonly templates: EmailTemplatesService,
    private readonly assets: BrandAssetsService,
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
      entityType: 'brand_profiles',
      entityId: null,
      meta: meta ?? null,
      ip: req.ip,
    });
  }

  /** The brand the signed-in person's company is showing: anyone signed in can read it. */
  @Get('current')
  current(@CurrentAuth() a: AccessClaims) {
    return this.brand.effective(a.tenantId);
  }

  @RequirePermission('brand.manage')
  @Get()
  state(@CurrentAuth() a: AccessClaims) {
    return this.brand.state(a.tenantId);
  }

  /** Body is the picture itself (PNG, JPEG or WebP); `kind` says what it is for. */
  @RequirePermission('brand.manage')
  @Post('assets')
  @HttpCode(201)
  async upload(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(uploadAssetQuery)) q: z.infer<typeof uploadAssetQuery>,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const r = await this.assets.upload(a.tenantId, a.userId, q.kind, body);
    await this.note(a, 'brand.image_uploaded', req, { kind: q.kind });
    return r;
  }

  @RequirePermission('brand.manage')
  @Put('draft')
  async save(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(saveBrandDraftBody))
    b: z.infer<typeof saveBrandDraftBody>,
    @Req() req: Request,
  ) {
    const s = await this.brand.saveDraft(a.tenantId, a.userId, b.draft);
    await this.note(a, 'brand.draft_saved', req);
    return s;
  }

  @RequirePermission('brand.manage')
  @Delete('draft')
  async discard(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    const s = await this.brand.discardDraft(a.tenantId);
    await this.note(a, 'brand.draft_discarded', req);
    return s;
  }

  /** The invitation email as it would look with this draft: the Email tab of the editor. */
  @RequirePermission('brand.manage')
  @Post('preview/email')
  @HttpCode(200)
  async previewEmail(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(previewBody)) b: z.infer<typeof previewBody>,
  ) {
    return this.templates.preview(
      'auth.invite',
      a.tenantId,
      { scheme: b.scheme },
      await this.brand.withDraft(a.tenantId, b.draft),
    );
  }

  @RequirePermission('brand.manage')
  @Post('publish')
  @HttpCode(200)
  async publish(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    const s = await this.brand.publish(a.tenantId, a.userId);
    await this.note(a, 'brand.published', req, { version: s.publishedVersion });
    return s;
  }

  @RequirePermission('brand.manage')
  @Post('revert')
  @HttpCode(200)
  async revert(@CurrentAuth() a: AccessClaims, @Req() req: Request) {
    const s = await this.brand.revert(a.tenantId, a.userId);
    await this.note(a, 'brand.reverted', req, { version: s.publishedVersion });
    return s;
  }
}
