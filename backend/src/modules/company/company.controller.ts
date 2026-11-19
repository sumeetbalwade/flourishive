import { findCompanyBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { CompanyService } from './company.service.js';

/** Open endpoints for the sign-in page. Nothing here needs, or reveals anything behind, a login. */
@Public()
@Controller('public')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  /** Name and accent colour for a company's sign-in page. 404 for unknown or suspended companies. */
  @Get('company/:slug')
  async get(@Param('slug') slug: string) {
    const c = await this.company.publicInfo(slug);
    if (!c) throw new NotFoundException('Company not found');
    return c;
  }

  /**
   * "Find my company": emails the person the sign-in address of every company they belong to.
   * Always answers 202, so it cannot be used to discover who has an account.
   */
  @Post('find-company')
  @HttpCode(202)
  async find(
    @Body(new ZodPipe(findCompanyBody)) b: z.infer<typeof findCompanyBody>,
    @Req() req: Request,
  ) {
    await this.company.emailSignInLinks(b.email, req.ip);
    return { status: 'accepted' };
  }
}
