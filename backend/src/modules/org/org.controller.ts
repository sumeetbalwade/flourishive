import { RequireFeature } from '../controls/require-feature.js';
import {
  orgBodies as bodies,
  ORG_KINDS,
  type OrgKind,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { OrgService } from './org.service.js';

function kindOf(raw: string): OrgKind {
  if (!(ORG_KINDS as readonly string[]).includes(raw))
    throw new BadRequestException('Unknown catalogue');
  return raw as OrgKind;
}

@RequireFeature('org')
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // Declared before ':kind' so "entities" is not read as a catalogue name.
  @Get('entities')
  @RequirePermission('org.read')
  entities(@CurrentAuth() a: AccessClaims) {
    return this.org.entities(a.tenantId);
  }

  @Get(':kind')
  @RequirePermission('org.read')
  list(@CurrentAuth() a: AccessClaims, @Param('kind') kind: string) {
    return this.org.list(a.tenantId, kindOf(kind));
  }

  @Post(':kind')
  @RequirePermission('org.write')
  create(
    @CurrentAuth() a: AccessClaims,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const k = kindOf(kind);
    return this.org.create(
      a.tenantId,
      k,
      new ZodPipe(bodies[k]).transform(body),
    );
  }

  @Patch(':kind/:id')
  @RequirePermission('org.write')
  update(
    @CurrentAuth() a: AccessClaims,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const k = kindOf(kind);
    return this.org.update(
      a.tenantId,
      k,
      id,
      new ZodPipe(bodies[k].partial()).transform(body),
    );
  }

  @Delete(':kind/:id')
  @HttpCode(204)
  @RequirePermission('org.write')
  remove(
    @CurrentAuth() a: AccessClaims,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.org.remove(a.tenantId, kindOf(kind), id);
  }
}
