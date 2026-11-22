import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { DscJobsService } from './dsc-jobs.service.js';
import { SigningService, type ClientInfo } from './signing.service.js';

const dscBody = z.object({
  method: z.literal('DSC'),
  signatoryUserId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(60).default(7),
});
const requestBody = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().toLowerCase().email().max(191),
  expiresInDays: z.number().int().min(1).max(60).default(7),
  finalStep: z.boolean().default(false),
});
const cancelBody = z.object({ reason: z.string().trim().min(1).max(500) });
const confirmBody = z.object({
  code: z.string().regex(/^\d{6}$/),
  consent: z.boolean(),
});
const declineBody = z.object({ reason: z.string().trim().max(500).optional() });

const client = (req: Request): ClientInfo => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

/** For HR: ask a candidate to accept an approved document, and follow the request. */
@Controller('documents/:id/signature-requests')
export class SigningStaffController {
  constructor(
    private readonly signing: SigningService,
    private readonly dsc: DscJobsService,
  ) {}

  @Post()
  @RequirePermission('documents.generate')
  request(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if ((body as { method?: string } | null)?.method === 'DSC')
      return this.dsc.request(a, id, new ZodPipe(dscBody).transform(body));
    return this.signing.requestOtp(
      a,
      id,
      new ZodPipe(requestBody).transform(body),
    );
  }

  @Get()
  @RequirePermission('documents.read')
  list(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.signing.list(a, id);
  }

  @Post(':requestId/cancel')
  @RequirePermission('documents.generate')
  async cancel(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Param('requestId') rid: string,
    @Body() body: unknown,
  ) {
    await this.signing.cancel(
      a,
      id,
      rid,
      new ZodPipe(cancelBody).transform(body).reason,
    );
    return { cancelled: true };
  }
}

/** For the candidate: the private link is the only credential. Nothing here needs a login. */
@Public()
@Controller('public')
export class AcceptanceController {
  constructor(private readonly signing: SigningService) {}

  @Get('accept/:token')
  describe(@Param('token') token: string, @Req() req: Request) {
    return this.signing.describe(token, client(req));
  }

  @Get('accept/:token/document')
  async document(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream, url } = await this.signing.document(
      token,
      client(req),
    );
    if (url) {
      stream.destroy();
      res.setHeader('Cache-Control', 'private, no-store');
      res.redirect(302, url);
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.originalName}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream);
  }

  @Post('accept/:token/code')
  code(@Param('token') token: string, @Req() req: Request) {
    return this.signing.sendCode(token, client(req));
  }

  @Post('accept/:token/confirm')
  confirm(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.signing.confirm(
      token,
      new ZodPipe(confirmBody).transform(body),
      client(req),
    );
  }

  @Post('accept/:token/decline')
  decline(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.signing.decline(
      token,
      new ZodPipe(declineBody).transform(body),
      client(req),
    );
  }

  /** The certificate our seals are made with, so a company can choose to trust it. */
  @Get('seal-certificate')
  @Header('Content-Type', 'application/x-pem-file')
  @Header('Content-Disposition', 'attachment; filename="flourishive-seal.pem"')
  certificate() {
    return this.signing.certificatePem();
  }
}
