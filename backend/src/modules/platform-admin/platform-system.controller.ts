import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

const STARTED_AT = new Date();

/** What the console shows about the running API, and the Restart button. */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/system')
export class PlatformSystemController {
  private readonly log = new Logger('System');

  constructor(
    private readonly audit: PlatformAuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // In production the service manager (systemd, Restart=always) starts the API again after it exits.
  // Elsewhere (development, tests) nothing would, so the button stays off.
  private get canRestart() {
    return this.config.NODE_ENV === 'production';
  }

  @Get() info() {
    return {
      canRestart: this.canRestart,
      version: this.config.APP_VERSION,
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /** Stops the API; the service manager starts it again within a few seconds. */
  @RequirePlatformPermission('platform.controls')
  @Post('restart')
  @RequireStepUp()
  @HttpCode(202)
  async restart(@Req() req: PlatformRequest) {
    if (!this.canRestart)
      throw new ServiceUnavailableException(
        'Restart is only available on the server, where the service restarts the API by itself.',
      );
    await this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action: 'platform.api_restart',
      entityType: 'system',
      meta: { version: this.config.APP_VERSION },
      ip: req.ip,
    });
    this.log.warn('Restart requested from the console');
    // Let this response go out first, then exit; open requests get a moment to finish.
    // SIGTERM runs Nest's shutdown hooks, so connections close cleanly.
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500).unref();
    return { restarting: true };
  }
}
