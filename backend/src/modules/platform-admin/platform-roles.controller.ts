import {
  platformAssignRoleBody,
  createPlatformRoleBody,
  updatePlatformRoleBody,
} from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { PLATFORM_PERMISSIONS } from './platform-permissions.js';
import { PlatformRolesService } from './platform-roles.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

/** Staff roles and who holds them (D-55). Changing roles asks the person to confirm it is them. */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformRolesController {
  constructor(private readonly roles: PlatformRolesService) {}

  private actor = (req: PlatformRequest) => req.platformAuth!.platformUserId;

  /** The roles with what each may do, and the catalogue of permissions with plain-English labels. */
  @RequirePlatformPermission('roles.manage', 'staff.manage')
  @Get('roles')
  async list() {
    return {
      roles: await this.roles.list(),
      permissions: Object.entries(PLATFORM_PERMISSIONS).map(([code, p]) => ({
        code,
        ...p,
      })),
    };
  }

  @RequirePlatformPermission('roles.manage')
  @RequireStepUp()
  @Post('roles')
  create(
    @Req() req: PlatformRequest,
    @Body(new ZodPipe(createPlatformRoleBody))
    b: z.infer<typeof createPlatformRoleBody>,
  ) {
    return this.roles.create(this.actor(req), b, req.ip);
  }

  @RequirePlatformPermission('roles.manage')
  @RequireStepUp()
  @Patch('roles/:id')
  @HttpCode(204)
  update(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updatePlatformRoleBody))
    b: z.infer<typeof updatePlatformRoleBody>,
  ) {
    return this.roles.update(this.actor(req), id, b, req.ip);
  }

  @RequirePlatformPermission('roles.manage')
  @RequireStepUp()
  @Delete('roles/:id')
  @HttpCode(204)
  remove(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.roles.remove(this.actor(req), id, req.ip);
  }

  @RequirePlatformPermission('staff.manage')
  @RequireStepUp()
  @Put('users/:id/role')
  @HttpCode(204)
  assign(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(platformAssignRoleBody))
    b: z.infer<typeof platformAssignRoleBody>,
  ) {
    return this.roles.assign(this.actor(req), id, b.roleId, req.ip);
  }
}
