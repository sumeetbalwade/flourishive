import {
  actionBody,
  bulkBody,
  generateBody,
  letterType,
  letterheadQuery,
  numberingBody,
  pageQuery,
  reviseBody,
  templateBody,
  templateVersionBody,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { DeliveryService } from './delivery.service.js';
import { BulkService } from './bulk.service.js';
import { DocumentsService } from './documents.service.js';
import { LetterheadsService } from './letterheads.service.js';
import { NumberingService } from './numbering.service.js';
import { TemplatesService } from './templates.service.js';

const uploadTemplateQuery = z.object({
  name: z.string().trim().min(1).max(120),
  letterType,
});
const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });
const supersedeBody = reasonBody.extend({ newDocumentId: z.string().uuid() });
const deliverBody = z.object({
  email: z.string().trim().email().max(191).optional(),
});
const listQuery = pageQuery.extend({ personId: z.string().uuid().optional() });

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly bulk: BulkService,
    private readonly delivery: DeliveryService,
    private readonly letterheads: LetterheadsService,
    private readonly numbering: NumberingService,
    private readonly templates: TemplatesService,
  ) {}

  @Get('layouts')
  @RequirePermission('documents.read')
  layouts() {
    return this.templates.layouts();
  }

  @Get('letterheads')
  @RequirePermission('documents.read')
  listLetterheads(@CurrentAuth() a: AccessClaims) {
    return this.letterheads.list(a);
  }

  /** Body is the letterhead itself: a PDF, or a PNG/JPG that is converted to an A4 PDF. */
  @Post('letterheads')
  @RequirePermission('documents.manage')
  addLetterhead(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(letterheadQuery)) q: z.infer<typeof letterheadQuery>,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    const mimeType = (contentType ?? '').split(';')[0]!.trim();
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mimeType))
      throw new UnsupportedMediaTypeException('Send a PDF, PNG or JPG');
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestException('Send the PDF as the request body');
    return this.letterheads.add(a, { body, mimeType, ...q });
  }

  @Get('numbering')
  @RequirePermission('documents.read')
  listNumbering(@CurrentAuth() a: AccessClaims) {
    return this.numbering.list(a);
  }

  @Put('numbering')
  @RequirePermission('documents.manage')
  saveNumbering(@CurrentAuth() a: AccessClaims, @Body() body: unknown) {
    return this.numbering.save(a, new ZodPipe(numberingBody).transform(body));
  }

  @Get('templates')
  @RequirePermission('documents.read')
  listTemplates(@CurrentAuth() a: AccessClaims) {
    return this.templates.list(a.tenantId);
  }

  @Post('templates')
  @RequirePermission('documents.manage')
  createTemplate(@CurrentAuth() a: AccessClaims, @Body() body: unknown) {
    return this.templates.create(a, new ZodPipe(templateBody).transform(body));
  }

  /** Body is the PDF (plain or fillable). It becomes a template that is issued as it is, or filled and flattened. */
  @Post('templates/upload')
  @RequirePermission('documents.manage')
  uploadTemplate(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(uploadTemplateQuery))
    q: z.infer<typeof uploadTemplateQuery>,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if ((contentType ?? '').split(';')[0]!.trim() !== 'application/pdf')
      throw new UnsupportedMediaTypeException('Send a PDF');
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestException('Send the PDF as the request body');
    return this.templates.createFromPdf(a, { ...q, body });
  }

  @Post('templates/starters')
  @RequirePermission('documents.manage')
  installStarters(@CurrentAuth() a: AccessClaims) {
    return this.templates.installStarters(a);
  }

  @Get('templates/:id')
  @RequirePermission('documents.read')
  getTemplate(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.templates.get(a.tenantId, id);
  }

  @Post('templates/:id/versions')
  @RequirePermission('documents.manage')
  addVersion(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.templates.addVersion(
      a,
      id,
      new ZodPipe(templateVersionBody).transform(body),
    );
  }

  @Post('templates/:id/archive')
  @RequirePermission('documents.manage')
  archive(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.templates.archive(a.tenantId, id);
  }

  @Post('generate')
  @RequirePermission('documents.generate')
  generate(@CurrentAuth() a: AccessClaims, @Body() body: unknown) {
    return this.docs.generate(a, new ZodPipe(generateBody).transform(body));
  }

  @Post('bulk')
  @RequirePermission('documents.generate')
  startBulk(@CurrentAuth() a: AccessClaims, @Body() body: unknown) {
    return this.bulk.create(a, new ZodPipe(bulkBody).transform(body));
  }

  @Post('bulk/:id/deliver')
  @RequirePermission('documents.generate')
  deliverBatch(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.delivery.deliverBatch(a, id);
  }

  @Get('bulk/:id')
  @RequirePermission('documents.generate')
  getBulk(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.bulk.get(a, id);
  }

  @Get()
  @RequirePermission('documents.read')
  list(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.docs.list(a, q);
  }

  @Post(':id/actions')
  @RequirePermission('documents.read')
  act(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = new ZodPipe(actionBody).transform(body);
    return this.docs.act(a, id, b.action, b.comment);
  }

  @Post(':id/revise')
  @RequirePermission('documents.generate')
  revise(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.docs.revise(
      a,
      id,
      new ZodPipe(reviseBody).transform(body).fields,
    );
  }

  @Post(':id/revoke')
  @RequirePermission('documents.approve')
  revoke(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.docs.revoke(
      a,
      id,
      new ZodPipe(reasonBody).transform(body).reason,
    );
  }

  @Post(':id/supersede')
  @RequirePermission('documents.approve')
  supersede(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.docs.supersede(
      a,
      id,
      new ZodPipe(supersedeBody).transform(body),
    );
  }

  @Post(':id/deliver')
  @RequirePermission('documents.generate')
  deliver(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.delivery.deliver(
      a,
      id,
      new ZodPipe(deliverBody).transform(body ?? {}).email,
    );
  }

  @Post(':id/release')
  @RequirePermission('documents.release')
  release(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.delivery.setRelease(a, id, true);
  }

  @Post(':id/hold')
  @RequirePermission('documents.release')
  hold(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.delivery.setRelease(a, id, false);
  }

  @Post(':id/delivery/revoke')
  @RequirePermission('documents.generate')
  revokeLinks(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.delivery.revoke(a, id);
  }

  @Get(':id/delivery')
  @RequirePermission('documents.read')
  deliveryStatus(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.delivery.status(a, id);
  }

  @Get(':id/history')
  @RequirePermission('documents.read')
  history(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.docs.history(a, id);
  }

  @Get(':id')
  @RequirePermission('documents.read')
  get(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.docs.get(a, id);
  }
}
