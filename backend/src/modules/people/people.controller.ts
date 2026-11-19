import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequirePermission } from '../access/require-permission.js';
import type { AuditableRequest } from '../audit/audit.interceptor.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import {
  createPersonBody,
  listQuery,
  updatePersonBody,
} from './people.schemas.js';
import { PeopleImportService } from './people-import.service.js';
import { PeopleService } from './people.service.js';
import type { z } from 'zod';

@Controller('people')
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly importer: PeopleImportService,
  ) {}

  @Get()
  @RequirePermission('people.read')
  list(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.people.list(a, q);
  }

  /**
   * Body is the raw CSV (Content-Type: text/csv). `dryRun` defaults to true: nothing is
   * written until the caller sends dryRun=false after reviewing the preview.
   */
  @Post('import')
  @HttpCode(200)
  @RequirePermission('people.import')
  import(
    @CurrentAuth() a: AccessClaims,
    @Body() csv: unknown,
    @Query('dryRun') dryRun = 'true',
    @Query('createMissing') createMissing = 'false',
    @Req() req: AuditableRequest,
  ) {
    req.auditSkip = dryRun !== 'false'; // a preview changes nothing
    if (typeof csv !== 'string')
      throw new BadRequestException('Send the CSV as text/csv');
    return this.importer.run(a, csv, {
      dryRun: dryRun !== 'false',
      createMissing: createMissing === 'true',
    });
  }

  @Get(':id')
  @RequirePermission('people.read')
  get(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.people.get(a, id);
  }

  @Post()
  @RequirePermission('people.write')
  create(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(createPersonBody)) b: z.infer<typeof createPersonBody>,
  ) {
    return this.people.create(a, b);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @RequirePermission('users.manage')
  invite(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.people.invite(a, id);
  }

  @Patch(':id')
  @HttpCode(200)
  @RequirePermission('people.write')
  update(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body(new ZodPipe(updatePersonBody)) b: z.infer<typeof updatePersonBody>,
  ) {
    return this.people.update(a, id, b);
  }
}
