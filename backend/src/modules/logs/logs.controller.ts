import {
  errorLogQuery,
  jobLogQuery,
  requestLogQuery,
  saveAlertsBody,
  signinLogQuery,
} from '@flourishive/schemas';
import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { AlertsService } from './alerts.service.js';
import { LogsService, type LogViewer } from './logs.service.js';

const q = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);
const viewer = (a: AccessClaims): LogViewer => ({
  tenantId: a.tenantId,
  detail: false,
});

/** Company side: this company's own logs, never another's, and no technical detail (D-67). */
@Controller('logs')
export class LogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly alerts: AlertsService,
  ) {}

  @RequirePermission('logs.read')
  @Get('requests')
  requests(
    @CurrentAuth() a: AccessClaims,
    @Query(q(requestLogQuery)) query: z.infer<typeof requestLogQuery>,
  ) {
    return this.logs.requests(query, viewer(a));
  }

  @RequirePermission('logs.read')
  @Get('errors')
  errors(
    @CurrentAuth() a: AccessClaims,
    @Query(q(errorLogQuery)) query: z.infer<typeof errorLogQuery>,
  ) {
    return this.logs.errors(query, viewer(a));
  }

  @RequirePermission('logs.read')
  @Get('signins')
  signins(
    @CurrentAuth() a: AccessClaims,
    @Query(q(signinLogQuery)) query: z.infer<typeof signinLogQuery>,
  ) {
    return this.logs.signins(query, viewer(a));
  }

  @RequirePermission('logs.read')
  @Get('jobs')
  jobs(
    @CurrentAuth() a: AccessClaims,
    @Query(q(jobLogQuery)) query: z.infer<typeof jobLogQuery>,
  ) {
    return this.logs.jobs(query, viewer(a));
  }

  @RequirePermission('logs.read')
  @Get('trace/:requestId')
  trace(@CurrentAuth() a: AccessClaims, @Param('requestId') id: string) {
    return this.logs.trace(id.slice(0, 64), viewer(a));
  }

  @RequirePermission('logs.read')
  @Get('trace/:requestId/copy')
  async copy(@CurrentAuth() a: AccessClaims, @Param('requestId') id: string) {
    return { text: await this.logs.supportCopy(id.slice(0, 64), viewer(a)) };
  }
}

/** Company side: which problems this person wants to hear about (D-68). Own subscriptions only. */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @RequirePermission('logs.read')
  @Get()
  list(@CurrentAuth() a: AccessClaims) {
    return this.alerts.list({
      type: 'USER',
      id: a.userId,
      tenantId: a.tenantId,
    });
  }

  @RequirePermission('logs.read')
  @Put()
  save(
    @CurrentAuth() a: AccessClaims,
    @Body(q(saveAlertsBody)) b: z.infer<typeof saveAlertsBody>,
  ) {
    return this.alerts.save(
      { type: 'USER', id: a.userId, tenantId: a.tenantId },
      b,
    );
  }
}
