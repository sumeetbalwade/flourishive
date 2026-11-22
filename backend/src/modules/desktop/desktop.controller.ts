import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { DscJobsService, type DeviceCtx } from '../signing/dsc-jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { CurrentDevice, DeviceGuard } from './device.guard.js';
import { DeviceService } from './device.service.js';

const pairBody = z.object({
  code: z.string().min(8).max(12),
  name: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(30),
  appVersion: z.string().trim().min(1).max(30),
});
const failBody = z.object({ reason: z.string().trim().min(1).max(300) });

/** For the signatory in the web app: pair a computer, see and unpair computers. */
@Controller('desktop')
export class DesktopStaffController {
  constructor(
    private readonly devices: DeviceService,
    private readonly access: AccessService,
  ) {}

  @Post('pairing-code')
  @RequirePermission('documents.sign')
  code(@CurrentAuth() a: AccessClaims) {
    return this.devices.pairingCode(a);
  }

  @Get('devices')
  @RequirePermission('documents.sign')
  list(@CurrentAuth() a: AccessClaims) {
    return this.devices.list(a, false);
  }

  @Post('devices/:id/revoke')
  @RequirePermission('documents.sign')
  async revoke(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    await this.devices.revoke(a, id, false);
    return { revoked: true };
  }
}

/** Open: the one-time code is the credential. */
@Public()
@Controller('desktop')
export class DesktopPairController {
  constructor(private readonly devices: DeviceService) {}

  @Post('pair')
  pair(@Body() body: unknown, @Req() req: Request) {
    return this.devices.pair(new ZodPipe(pairBody).transform(body), req.ip);
  }
}

/** What the desktop app calls once paired. Every route needs the device credential. */
@Public()
@UseGuards(DeviceGuard)
@Controller('desktop')
export class DesktopJobsController {
  constructor(private readonly jobs: DscJobsService) {}

  @Get('me')
  me(@CurrentDevice() d: DeviceCtx) {
    return { deviceId: d.deviceId, pollSeconds: 30 };
  }

  @Get('jobs')
  list(@CurrentDevice() d: DeviceCtx) {
    return this.jobs.list(d);
  }

  @Post('jobs/:id/claim')
  claim(@CurrentDevice() d: DeviceCtx, @Param('id') id: string) {
    return this.jobs.claim(d, id);
  }

  @Get('jobs/:id/input')
  async input(
    @CurrentDevice() d: DeviceCtx,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream, url } = await this.jobs.input(d, id);
    res.setHeader('X-Content-SHA256', file.sha256);
    if (url) {
      stream.destroy();
      res.setHeader('Cache-Control', 'private, no-store');
      res.redirect(302, url);
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.originalName}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-SHA256', file.sha256);
    return new StreamableFile(stream);
  }

  @Post('jobs/:id/release')
  async release(@CurrentDevice() d: DeviceCtx, @Param('id') id: string) {
    await this.jobs.release(d, id);
    return { released: true };
  }

  @Post('jobs/:id/fail')
  async fail(
    @CurrentDevice() d: DeviceCtx,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.jobs.fail(d, id, new ZodPipe(failBody).transform(body).reason);
    return { recorded: true };
  }

  /** Body is the signed PDF. */
  @Put('jobs/:id/signed')
  @Header('Cache-Control', 'no-store')
  submit(
    @CurrentDevice() d: DeviceCtx,
    @Param('id') id: string,
    @Headers('content-type') ct: string | undefined,
    @Body() body: unknown,
  ) {
    if ((ct ?? '').split(';')[0]!.trim() !== 'application/pdf')
      throw new UnsupportedMediaTypeException('Send the signed PDF');
    if (
      !Buffer.isBuffer(body) ||
      !body.length ||
      body.subarray(0, 5).toString('latin1') !== '%PDF-'
    )
      throw new BadRequestException('Send the signed PDF as the request body');
    return this.jobs.submit(d, id, body);
  }
}
