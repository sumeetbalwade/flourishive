import {
  generateBody,
  letterheadQuery,
  numberingBody,
  pageQuery,
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
import { DocumentsService } from './documents.service.js';
import { LetterheadsService } from './letterheads.service.js';
import { NumberingService } from './numbering.service.js';
import { TemplatesService } from './templates.service.js';

const listQuery = pageQuery.extend({ personId: z.string().uuid().optional() });

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
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

  @Get()
  @RequirePermission('documents.read')
  list(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.docs.list(a, q);
  }

  @Get(':id')
  @RequirePermission('documents.read')
  get(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.docs.get(a, id);
  }
}
