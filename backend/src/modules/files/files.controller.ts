import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
  Res,
  Body,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { ALLOWED_MIME_TYPES, FilesService } from './files.service.js';

const uploadQuery = z.object({
  name: z.string().trim().min(1).max(255),
  ownerType: z.string().max(60).optional(),
  ownerId: z.string().max(64).optional(),
});
const signedQuery = z.object({
  expires: z.coerce.number().int(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
});

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Body is the raw file; Content-Type must be one of the allowed types. */
  @Post()
  @RequirePermission('files.write')
  async upload(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(uploadQuery)) q: z.infer<typeof uploadQuery>,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    const mimeType = (contentType ?? '').split(';')[0]!.trim();
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new UnsupportedMediaTypeException(
        `Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
    if (!Buffer.isBuffer(body))
      throw new BadRequestException('Send the file as the request body');
    return this.files.upload(a, { body, mimeType, ...q });
  }

  @Get(':id')
  @RequirePermission('files.read')
  async meta(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    const { file, url, expiresAt } = await this.files.linkFor(a.tenantId, id);
    return { ...file, downloadUrl: url, downloadUrlExpiresAt: expiresAt };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('files.write')
  remove(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.files.remove(a.tenantId, id);
  }

  @Public()
  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Query(new ZodPipe(signedQuery)) q: z.infer<typeof signedQuery>,
    @Res() res: Response,
    @Req() _req: Request,
  ) {
    const { file, stream } = await this.files.openSigned(id, q.expires, q.sig);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.originalName.replace(/"/g, '')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  }
}
