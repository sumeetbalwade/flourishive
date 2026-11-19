import { assignRoleBody as assignBody } from '@flourishive/schemas';
import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { AccessService } from './access.service.js';
import { RequirePermission } from './require-permission.js';

@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('roles')
  @RequirePermission('roles.read')
  async roles(@CurrentAuth() a: AccessClaims) {
    const roles = await this.access.listRoles(a.tenantId);
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      mfaRequired: r.mfaRequired,
      permissions: r.permissions.map((p) => p.permissionCode).sort(),
    }));
  }

  @Post('user-roles')
  @HttpCode(204)
  @RequirePermission('roles.assign')
  async assign(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(assignBody)) b: z.infer<typeof assignBody>,
  ) {
    await this.access.assignRole(a.tenantId, a.userId, b);
  }

  @Delete('user-roles')
  @HttpCode(204)
  @RequirePermission('roles.assign')
  async remove(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(assignBody)) b: z.infer<typeof assignBody>,
  ) {
    await this.access.removeRole(a.tenantId, b);
  }
}
