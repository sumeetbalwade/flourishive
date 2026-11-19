import {
  assignRoleBody as assignBody,
  createRoleBody,
  tenantPolicyPatch,
} from '@flourishive/schemas';
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
import { z } from 'zod';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { AccessService } from './access.service.js';
import { RolePolicyService } from './role-policy.service.js';
import { RequirePermission } from './require-permission.js';

@Controller('access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly policies: RolePolicyService,
  ) {}

  @Get('roles')
  @RequirePermission('roles.read')
  async roles(@CurrentAuth() a: AccessClaims) {
    const roles = await this.access.listRoles(a.tenantId);
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      mfaLevel: r.mfaLevel,
      recoveryEmail: r.recoveryEmail,
      recoveryCodes: r.recoveryCodes,
      permissions: r.permissions.map((p) => p.permissionCode).sort(),
    }));
  }

  @Get('users/:userId/roles')
  @RequirePermission('roles.read')
  userRoles(@CurrentAuth() a: AccessClaims, @Param('userId') userId: string) {
    return this.access.listUserRoles(a.tenantId, userId);
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

  /** Two-step and recovery policy per role, with the lowest level the platform allows. */
  @Get('policies')
  @RequirePermission('roles.read')
  policyList(@CurrentAuth() a: AccessClaims) {
    return this.policies.tenantPolicies(a.tenantId);
  }

  @Put('policies/:roleKey')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async setPolicy(
    @CurrentAuth() a: AccessClaims,
    @Param('roleKey') roleKey: string,
    @Body(new ZodPipe(tenantPolicyPatch)) b: z.infer<typeof tenantPolicyPatch>,
  ) {
    await this.policies.setTenantPolicy(a.tenantId, roleKey, b);
  }

  /** A custom role for this company. It starts with sign-in access only; permissions are added separately. */
  @Post('roles')
  @RequirePermission('settings.manage')
  createRole(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(createRoleBody)) b: z.infer<typeof createRoleBody>,
  ) {
    return this.access.createRole(a.tenantId, b);
  }
}
