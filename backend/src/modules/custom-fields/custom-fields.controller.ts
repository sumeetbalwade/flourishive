import {
  customFieldBody,
  customFieldEntity,
  customFieldValuesBody,
  type CustomFieldBody,
  type CustomFieldValuesBody,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { CustomFieldsService } from './custom-fields.service.js';

const entity = (raw: string) => {
  const r = customFieldEntity.safeParse(raw.toUpperCase());
  if (!r.success) throw new BadRequestException('Unknown kind of record');
  return r.data;
};

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(
    private readonly fields: CustomFieldsService,
    private readonly access: AccessService,
  ) {}

  /** Managers see every field (also archived); everyone else what their roles may see. */
  @RequirePermission('people.read')
  @Get('definitions')
  async list(
    @CurrentAuth() a: AccessClaims,
    @Query('entityType') entityType?: string,
  ) {
    const manager = await this.access.can(
      a.tenantId,
      a.userId,
      'custom_fields.manage',
    );
    return this.fields.list(
      a.tenantId,
      a.userId,
      entityType ? entity(entityType) : undefined,
      manager,
    );
  }

  @RequirePermission('custom_fields.manage')
  @Post('definitions')
  create(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(customFieldBody)) b: CustomFieldBody,
  ) {
    return this.fields.create(a.tenantId, b);
  }

  @RequirePermission('custom_fields.manage')
  @Put('definitions/:id')
  update(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Body(new ZodPipe(customFieldBody)) b: CustomFieldBody,
  ) {
    return this.fields.update(a.tenantId, id, b);
  }

  @RequirePermission('custom_fields.manage')
  @HttpCode(204)
  @Post('definitions/:id/archive')
  archive(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.fields.archive(a.tenantId, id, true);
  }

  @RequirePermission('custom_fields.manage')
  @HttpCode(204)
  @Post('definitions/:id/restore')
  restore(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.fields.archive(a.tenantId, id, false);
  }

  @RequirePermission('people.read')
  @Get('values/:entityType/:entityId')
  values(
    @CurrentAuth() a: AccessClaims,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.fields.values(
      a.tenantId,
      a.userId,
      entity(entityType),
      entityId,
    );
  }

  @RequirePermission('people.write')
  @Put('values/:entityType/:entityId')
  save(
    @CurrentAuth() a: AccessClaims,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body(new ZodPipe(customFieldValuesBody)) b: CustomFieldValuesBody,
  ) {
    return this.fields.saveValues(
      a.tenantId,
      a.userId,
      entity(entityType),
      entityId,
      b.values,
    );
  }
}
