import {
  errorLogQuery,
  jobLogQuery,
  requestLogQuery,
  saveAlertsBody,
  signinLogQuery,
} from '@flourishive/schemas';
import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { AlertsService } from '../logs/alerts.service.js';
import { LogsService, type LogViewer } from '../logs/logs.service.js';
import { UseGuards } from '@nestjs/common';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

const q = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);
const viewer = (req: PlatformRequest): LogViewer => ({
  tenantId: null,
  detail: req.platformAuth?.permissions.has('logs.errors.detail') ?? false,
});

/** Super admin: logs across every company, and own alert subscriptions (D-67, D-68). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformLogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly alerts: AlertsService,
  ) {}

  @RequirePlatformPermission('logs.read')
  @Get('logs/requests')
  requests(
    @Req() req: PlatformRequest,
    @Query(q(requestLogQuery)) query: z.infer<typeof requestLogQuery>,
  ) {
    return this.logs.requests(query, viewer(req));
  }

  @RequirePlatformPermission('logs.read')
  @Get('logs/errors')
  errors(
    @Req() req: PlatformRequest,
    @Query(q(errorLogQuery)) query: z.infer<typeof errorLogQuery>,
  ) {
    return this.logs.errors(query, viewer(req));
  }

  @RequirePlatformPermission('logs.read')
  @Get('logs/signins')
  signins(
    @Req() req: PlatformRequest,
    @Query(q(signinLogQuery)) query: z.infer<typeof signinLogQuery>,
  ) {
    return this.logs.signins(query, viewer(req));
  }

  @RequirePlatformPermission('logs.read')
  @Get('logs/jobs')
  jobs(
    @Req() req: PlatformRequest,
    @Query(q(jobLogQuery)) query: z.infer<typeof jobLogQuery>,
  ) {
    return this.logs.jobs(query, viewer(req));
  }

  @RequirePlatformPermission('logs.read')
  @Get('logs/trace/:requestId')
  trace(@Req() req: PlatformRequest, @Param('requestId') id: string) {
    return this.logs.trace(id.slice(0, 64), viewer(req));
  }

  @RequirePlatformPermission('logs.read')
  @Get('logs/trace/:requestId/copy')
  async copy(@Req() req: PlatformRequest, @Param('requestId') id: string) {
    return { text: await this.logs.supportCopy(id.slice(0, 64), viewer(req)) };
  }

  @RequirePlatformPermission('alerts.manage')
  @Get('alerts')
  listAlerts(@Req() req: PlatformRequest) {
    return this.alerts.list({
      type: 'PLATFORM_USER',
      id: req.platformAuth!.platformUserId,
      tenantId: null,
    });
  }

  @RequirePlatformPermission('alerts.manage')
  @Put('alerts')
  saveAlerts(
    @Req() req: PlatformRequest,
    @Body(q(saveAlertsBody)) b: z.infer<typeof saveAlertsBody>,
  ) {
    return this.alerts.save(
      {
        type: 'PLATFORM_USER',
        id: req.platformAuth!.platformUserId,
        tenantId: null,
      },
      b,
    );
  }
}
