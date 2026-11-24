import { apiClientBody, type ApiClientBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RequirePermission } from '../access/require-permission.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { ApiClientsService } from './api-clients.service.js';

/** Company side: manage the systems that may call the public API. */
@Controller('api-clients')
export class ApiClientsController {
  constructor(private readonly clients: ApiClientsService) {}

  @RequirePermission('settings.read')
  @Get()
  list(@CurrentAuth() a: AccessClaims) {
    return this.clients.list(a.tenantId);
  }

  @RequirePermission('settings.manage')
  @RequireStepUp()
  @Post()
  create(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(apiClientBody)) b: ApiClientBody,
  ) {
    return this.clients.create(a.tenantId, a.userId, b);
  }

  @RequirePermission('settings.manage')
  @Put(':id')
  update(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body(new ZodPipe(apiClientBody)) b: ApiClientBody,
  ) {
    return this.clients.update(a.tenantId, id, b);
  }

  @RequirePermission('settings.manage')
  @RequireStepUp()
  @HttpCode(200)
  @Post(':id/rotate')
  rotate(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.clients.rotate(a.tenantId, id);
  }

  @RequirePermission('settings.manage')
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.clients.remove(a.tenantId, id);
  }
}
