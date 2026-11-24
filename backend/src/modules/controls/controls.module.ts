import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BrandModule } from '../brand/brand.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AnnouncementsService } from './announcements.service.js';
import {
  AnnouncementsController,
  MaintenancePublicController,
} from './controls.controller.js';
import { FeaturesService } from './features.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { FeatureGuard } from './require-feature.js';
import { TenantTransferService } from './tenant-transfer.service.js';
import { UsageService } from './usage.service.js';

/** Platform controls (D-70). Global so any module can check a feature switch. */
@Global()
@Module({
  imports: [SettingsModule, BrandModule],
  controllers: [AnnouncementsController, MaintenancePublicController],
  providers: [
    FeaturesService,
    AnnouncementsService,
    MaintenanceService,
    UsageService,
    TenantTransferService,
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
  exports: [
    FeaturesService,
    AnnouncementsService,
    MaintenanceService,
    UsageService,
    TenantTransferService,
  ],
})
export class ControlsModule {}
