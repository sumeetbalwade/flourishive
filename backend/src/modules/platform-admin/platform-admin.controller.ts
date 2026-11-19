import {
  patchTenantBody as patchTenant,
  inviteStaffBody as inviteBody,
  staffStatusBody as statusBody,
  settingValueBody as valueBody,
  createTenantBody,
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
import { ZodPipe } from '../identity/zod.pipe.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { PlatformGuard, type PlatformRequest } from './platform.guard.js';

/** The super admin console API. Not reachable with a tenant token. */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  private actor = (req: PlatformRequest) => req.platformAuth!.platformUserId;

  @Get('tenants') tenants() {
    return this.admin.listTenants();
  }

  @Get('tenants/:id') tenant(@Param('id') id: string) {
    return this.admin.getTenant(id);
  }

  @Post('tenants')
  create(
    @Req() req: PlatformRequest,
    @Body(new ZodPipe(createTenantBody)) b: z.infer<typeof createTenantBody>,
  ) {
    return this.admin.createTenant(this.actor(req), b, req.ip);
  }

  @Patch('tenants/:id')
  @HttpCode(204)
  update(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(patchTenant)) b: z.infer<typeof patchTenant>,
  ) {
    return this.admin.updateTenant(this.actor(req), id, b, req.ip);
  }

  @Get('users') users() {
    return this.admin.listUsers();
  }

  @Post('users')
  invite(
    @Req() req: PlatformRequest,
    @Body(new ZodPipe(inviteBody)) b: z.infer<typeof inviteBody>,
  ) {
    return this.admin.inviteUser(this.actor(req), b.email);
  }

  @Patch('users/:id')
  @HttpCode(204)
  setStatus(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(statusBody)) b: z.infer<typeof statusBody>,
  ) {
    return this.admin.setUserStatus(this.actor(req), id, b.status);
  }

  @Get('settings') settings() {
    return this.admin.platformSettings();
  }

  @Put('settings/:key')
  @HttpCode(204)
  setDefault(
    @Req() req: PlatformRequest,
    @Param('key') key: string,
    @Body(new ZodPipe(valueBody)) b: z.infer<typeof valueBody>,
  ) {
    return this.admin.setPlatformSetting(this.actor(req), key, b.value);
  }

  @Put('tenants/:id/settings/:key')
  @HttpCode(204)
  setTenantValue(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodPipe(valueBody)) b: z.infer<typeof valueBody>,
  ) {
    return this.admin.setTenantSetting(this.actor(req), id, key, b.value);
  }

  @Delete('tenants/:id/settings/:key')
  @HttpCode(204)
  clearTenantValue(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Param('key') key: string,
  ) {
    return this.admin.clearTenantSetting(this.actor(req), id, key);
  }
}
