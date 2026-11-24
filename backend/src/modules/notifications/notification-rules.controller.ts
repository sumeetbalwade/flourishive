import { saveRulesBody } from '@flourishive/schemas';
import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { NotificationRulesService } from './notification-rules.service.js';

/** Which roles are told about which events (D-69). */
@Controller('notification-rules')
export class NotificationRulesController {
  constructor(
    private readonly rules: NotificationRulesService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('settings.read')
  @Get()
  matrix(@CurrentAuth() a: AccessClaims) {
    return this.rules.matrix(a.tenantId);
  }

  @RequirePermission('settings.manage')
  @Put()
  async save(
    @CurrentAuth() a: AccessClaims,
    @Body(new ZodPipe(saveRulesBody)) b: z.infer<typeof saveRulesBody>,
    @Req() req: Request,
  ) {
    const m = await this.rules.save(a.tenantId, a.userId, b.cells);
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'notification_rules.saved',
      entityType: 'notification_rules',
      meta: { changed: b.cells.length },
      ip: req.ip,
    });
    return m;
  }
}
