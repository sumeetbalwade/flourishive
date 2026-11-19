import { Controller, Get } from '@nestjs/common';

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
