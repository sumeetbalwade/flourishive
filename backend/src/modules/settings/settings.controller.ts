import { settingValueBody as valueBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { SETTINGS } from './registry.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** The caller's effective settings plus what can be changed where. */
  @Get()
  @RequirePermission('self.read')
  async all(@CurrentAuth() a: AccessClaims) {
    return {
      values: await this.settings.resolveAll({
        tenantId: a.tenantId,
        userId: a.userId,
      }),
      locked: await this.settings.lockedKeys(),
      definitions: Object.fromEntries(
        Object.entries(SETTINGS)
          .filter(([, d]) => d.levels.length > 0)
          .map(([k, d]) => [
            k,
            { levels: d.levels, description: d.description },
          ]),
      ),
    };
  }

  @Put('tenant/:key')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async setTenant(
    @CurrentAuth() a: AccessClaims,
    @Param('key') key: string,
    @Body(new ZodPipe(valueBody)) b: z.infer<typeof valueBody>,
  ) {
    await this.settings.set(
      { tenantId: a.tenantId, updatedBy: a.userId },
      'tenant',
      key,
      b.value,
    );
  }

  @Delete('tenant/:key')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async clearTenant(@CurrentAuth() a: AccessClaims, @Param('key') key: string) {
    await this.settings.clear({ tenantId: a.tenantId }, 'tenant', key);
  }

  @Put('entity/:entityId/:key')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async setEntity(
    @CurrentAuth() a: AccessClaims,
    @Param('entityId') entityId: string,
    @Param('key') key: string,
    @Body(new ZodPipe(valueBody)) b: z.infer<typeof valueBody>,
  ) {
    await this.settings.set(
      { tenantId: a.tenantId, updatedBy: a.userId },
      'entity',
      key,
      b.value,
      entityId,
    );
  }

  /** Personal preferences (only keys that allow the user level). */
  @Put('me/:key')
  @HttpCode(204)
  @RequirePermission('self.read')
  async setMine(
    @CurrentAuth() a: AccessClaims,
    @Param('key') key: string,
    @Body(new ZodPipe(valueBody)) b: z.infer<typeof valueBody>,
  ) {
    await this.settings.set(
      { tenantId: a.tenantId, userId: a.userId, updatedBy: a.userId },
      'user',
      key,
      b.value,
    );
  }
}
