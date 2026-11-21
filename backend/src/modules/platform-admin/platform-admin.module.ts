import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { AuditWatchService } from './audit-watch.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformGuard } from './platform.guard.js';

@Module({
  imports: [IdentityModule, AccessModule, SettingsModule],
  controllers: [PlatformAuthController, PlatformAdminController],
  providers: [
    PlatformAuthService,
    PlatformAdminService,
    PlatformAuditService,
    AuditWatchService,
    PlatformGuard,
  ],
  exports: [PlatformAuthService, PlatformAuditService, AuditWatchService],
})
export class PlatformAdminModule {}
