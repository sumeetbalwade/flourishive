import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { VerifyService } from './verify.service.js';

const refQuery = z.object({
  company: z.string().trim().min(1).max(63),
  reference: z.string().trim().min(3).max(80),
});

/** Open to anyone: it only confirms or denies that a document was issued, and reveals no personal data. */
@Public()
@Controller('public/verify')
export class VerifyController {
  constructor(private readonly verify: VerifyService) {}

  // Declared before ':token' so "lookup" is not read as a token.
  @Get('lookup')
  lookup(
    @Query(new ZodPipe(refQuery)) q: z.infer<typeof refQuery>,
    @Req() req: Request,
  ) {
    return this.verify.byReference(q.company, q.reference, req.ip);
  }

  @Get(':token')
  byToken(@Param('token') token: string, @Req() req: Request) {
    return this.verify.byToken(token, req.ip);
  }

  /** Body is the PDF to check. */
  @Post(':token/compare')
  compare(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.subarray(0, 5).toString('latin1') !== '%PDF-'
    )
      throw new BadRequestException('Send the PDF file to check');
    return this.verify.compare(token, body, req.ip);
  }
}
