import { Controller, Get } from '@nestjs/common';
import { Public } from '../../modules/identity/auth.context.js';

export interface HealthStatus {
  status: 'ok';
  service: 'flourishive-api';
  version: string;
  time: string;
}

/**
 * Liveness check used by the uptime monitor and the cron keep-warm ping.
 * Served at GET /v1/health. Later phases add database and Redis checks.
 */
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'flourishive-api',
      version: process.env.APP_VERSION ?? 'dev',
      time: new Date().toISOString(),
    };
  }
}
