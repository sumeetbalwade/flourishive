import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** What the system has emailed for this tenant, newest first. */
  @Get()
  @RequirePermission('audit.read')
  list(@CurrentAuth() a: AccessClaims) {
    return this.notifications.list(a.tenantId);
  }
}
