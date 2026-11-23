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
import { ConfigTestService } from './config-test.service.js';
import { PlatformConfigController } from './platform-config.controller.js';
import { PlatformGuard } from './platform.guard.js';

@Module({
  imports: [IdentityModule, AccessModule, SettingsModule],
  controllers: [
    PlatformAuthController,
    PlatformAdminController,
    PlatformConfigController,
  ],
  providers: [
    PlatformAuthService,
    PlatformAdminService,
    CompanyDnsService,
    PlatformAuditService,
    AuditWatchService,
    PlatformGuard,
    ConfigTestService,
  ],
  exports: [PlatformAuthService, PlatformAuditService, AuditWatchService],
})
export class PlatformAdminModule {}
