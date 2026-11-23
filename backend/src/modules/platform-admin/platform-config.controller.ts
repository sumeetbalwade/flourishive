import { runtimeConfigBody } from '@flourishive/schemas';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { RUNTIME_GROUPS } from '../../platform/config/runtime-keys.js';
import { Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { ConfigTestService } from './config-test.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformGuard, type PlatformRequest } from './platform.guard.js';

/** Keys, mail server and addresses that used to need an edit of `api.env` (D-57). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/config')
export class PlatformConfigController {
  constructor(
    private readonly runtime: RuntimeConfigService,
    private readonly tests: ConfigTestService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Get() list() {
    return this.runtime.describe();
  }

  /** Secrets are write-only: the value is never returned, only whether one is set. */
  @Put(':key')
  @RequireStepUp()
  @HttpCode(204)
  async set(
    @Req() req: PlatformRequest,
    @Param('key') key: string,
    @Body(new ZodPipe(runtimeConfigBody)) b: z.infer<typeof runtimeConfigBody>,
  ) {
    const actorId = req.platformAuth!.platformUserId;
    await this.runtime.set(key, b.value, actorId);
    // The value is never written to the audit log; only which setting changed.
    await this.audit.record({
      actorId,
      action: 'platform.config_set',
      entityType: 'platform_config',
      entityId: key,
      meta: { key },
      ip: req.ip,
    });
  }

  @Delete(':key')
  @RequireStepUp()
  @HttpCode(204)
  async clear(@Req() req: PlatformRequest, @Param('key') key: string) {
    await this.runtime.clear(key);
    await this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action: 'platform.config_cleared',
      entityType: 'platform_config',
      entityId: key,
      meta: { key },
      ip: req.ip,
    });
  }

  @Post('test/:group')
  @HttpCode(200)
  test(@Param('group') group: string) {
    const found = RUNTIME_GROUPS.find(
      (g) => g.toLowerCase().replace(/\s+/g, '-') === group,
    );
    if (!found) throw new BadRequestException('Unknown group');
    return this.tests.run(found);
  }
}
