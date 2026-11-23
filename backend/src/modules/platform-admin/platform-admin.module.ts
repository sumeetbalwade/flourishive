import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { CompanyDnsService } from './company-dns.service.js';
import { AuditWatchService } from './audit-watch.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformSystemController } from './platform-system.controller.js';
import {
  PlatformSupportController,
  TenantSupportController,
} from './support-controllers.js';
import { SupportSessionsService } from './support-sessions.service.js';
import { PlatformRolesController } from './platform-roles.controller.js';
import { PlatformRolesService } from './platform-roles.service.js';
import {
  PlatformAccountsController,
  TenantAccountsController,
} from './accounts-controllers.js';
import { StaffActionsService } from './staff-actions.service.js';
import { ConfigTestService } from './config-test.service.js';
import { PlatformConfigController } from './platform-config.controller.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformMailController } from './platform-mail.controller.js';
import { MailAdminModule } from '../mail/mail-admin.module.js';

@Module({
  imports: [IdentityModule, AccessModule, SettingsModule, MailAdminModule],
  controllers: [
    PlatformMailController,
    PlatformAuthController,
    PlatformAdminController,
    PlatformConfigController,
    PlatformSystemController,
    PlatformRolesController,
    PlatformSupportController,
    TenantSupportController,
    PlatformAccountsController,
    TenantAccountsController,
  ],
  providers: [
    PlatformAuthService,
    PlatformAdminService,
    CompanyDnsService,
    PlatformAuditService,
    AuditWatchService,
    PlatformGuard,
    ConfigTestService,
    PlatformRolesService,
    SupportSessionsService,
    StaffActionsService,
  ],
  exports: [PlatformAuthService, PlatformAuditService, AuditWatchService],
})
export class PlatformAdminModule {}
