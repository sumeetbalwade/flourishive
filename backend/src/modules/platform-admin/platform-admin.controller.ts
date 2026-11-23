import {
  patchTenantBody as patchTenant,
  inviteStaffBody as inviteBody,
  staffStatusBody as statusBody,
  settingValueBody as valueBody,
  createTenantBody,
  platformPolicyPatch,
  platformSettingBody,
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
import { StorageService } from '../../platform/storage/storage.service.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

/** The super admin console API. Not reachable with a tenant token. */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformAdminController {
  constructor(
    private readonly admin: PlatformAdminService,
    private readonly storage: StorageService,
  ) {}

  private actor = (req: PlatformRequest) => req.platformAuth!.platformUserId;

  @RequirePlatformPermission('config.read')
  /** Is file storage working? Writes and removes a tiny test file. */
  @Get('diagnostics/storage')
  storageCheck() {
    return this.storage.check();
  }

  @RequirePlatformPermission('tenants.read')
  @Get('tenants')
  tenants() {
    return this.admin.listTenants();
  }

  @RequirePlatformPermission('tenants.read')
  @Get('tenants/:id')
  tenant(@Param('id') id: string) {
    return this.admin.getTenant(id);
  }

  @RequirePlatformPermission('tenants.manage')
  @Post('tenants')
  create(
    @Req() req: PlatformRequest,
    @Body(new ZodPipe(createTenantBody)) b: z.infer<typeof createTenantBody>,
  ) {
    return this.admin.createTenant(this.actor(req), b, req.ip);
  }

  @RequirePlatformPermission('tenants.manage')
  @Patch('tenants/:id')
  @HttpCode(204)
  update(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(patchTenant)) b: z.infer<typeof patchTenant>,
  ) {
    return this.admin.updateTenant(this.actor(req), id, b, req.ip);
  }

  @RequirePlatformPermission('tenants.manage')
  /** Creates the company's address in Cloudflare again (after a failure, or a changed server address). */
  @Post('tenants/:id/dns')
  @HttpCode(200)
  syncDns(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.admin.syncDns(this.actor(req), id, req.ip);
  }

  @RequirePlatformPermission('staff.manage')
  @Get('users')
  users() {
    return this.admin.listUsers();
  }

  @RequirePlatformPermission('staff.manage')
  @Post('users')
  invite(
    @Req() req: PlatformRequest,
    @Body(new ZodPipe(inviteBody)) b: z.infer<typeof inviteBody>,
  ) {
    return this.admin.inviteUser(this.actor(req), b.email, b.roleId);
  }

  @RequirePlatformPermission('staff.manage')
  @RequireStepUp()
  @Patch('users/:id')
  @HttpCode(204)
  setStatus(
    @Req() req: PlatformRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(statusBody)) b: z.infer<typeof statusBody>,
  ) {
    return this.admin.setUserStatus(this.actor(req), id, b.status);
  }

  @RequirePlatformPermission('config.read')
  @Get('settings')
  settings() {
    return this.admin.platformSettings();
  }

  @RequirePlatformPermission('platform.controls')
  @Put('settings/:key')
  @HttpCode(204)
  setDefault(
    @Req() req: PlatformRequest,
    @Param('key') key: string,
    @Body(new ZodPipe(platformSettingBody))
    b: z.infer<typeof platformSettingBody>,
  ) {
    return this.admin.setPlatformSetting(
      this.actor(req),
      key,
      b.value,
      b.locked,
    );
  }

  @RequirePlatformPermission('platform.controls')
  @Delete('settings/:key')
  @HttpCode(204)
  clearDefault(@Req() req: PlatformRequest, @Param('key') key: string) {
    return this.admin.clearPlatformSetting(this.actor(req), key);
  }

  @RequirePlatformPermission('config.read')
  /** Two-step and recovery defaults, and the floor tenants cannot go below, per system role. */
  @Get('policies')
  policies() {
    return this.admin.platformPolicies();
  }

  @RequirePlatformPermission('platform.controls')
  @Put('policies/:roleKey')
  @HttpCode(204)
  setPolicy(
    @Req() req: PlatformRequest,
    @Param('roleKey') roleKey: string,
    @Body(new ZodPipe(platformPolicyPatch))
    b: z.infer<typeof platformPolicyPatch>,
  ) {
    return this.admin.setPlatformPolicy(this.actor(req), roleKey, b);
  }

  @RequirePlatformPermission('tenants.manage')
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

  @RequirePlatformPermission('tenants.manage')
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
