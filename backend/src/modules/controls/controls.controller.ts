import { Controller, Get } from '@nestjs/common';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { AnnouncementsService } from './announcements.service.js';
import { MaintenanceService } from './maintenance.service.js';

/** Company side: banners that are showing now. */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('active')
  active(@CurrentAuth() a: AccessClaims) {
    return this.announcements.activeFor(a.tenantId);
  }
}

/** Open: the maintenance page (and the sign-in page) ask whether the platform is in maintenance. */
@Public()
@Controller('public')
export class MaintenancePublicController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('maintenance')
  state() {
    return this.maintenance.state();
  }
}
