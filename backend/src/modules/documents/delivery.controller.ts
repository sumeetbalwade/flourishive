import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../identity/auth.context.js';
import { DeliveryService } from './delivery.service.js';

/** The emailed link. The private token is the credential; nothing here lists or searches. */
@Public()
@Controller('public/delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get(':token')
  describe(@Param('token') token: string, @Req() req: Request) {
    return this.delivery.describe(token, req.ip);
  }

  @Get(':token/download')
  async download(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { file, stream, url } = await this.delivery.download(token, req.ip);
    res.setHeader('Cache-Control', 'private, no-store');
    if (url) {
      stream.destroy();
      res.redirect(302, url);
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.originalName.replace(/"/g, '')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }
}
