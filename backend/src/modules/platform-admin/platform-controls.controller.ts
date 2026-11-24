import {
  announcementBody,
  featureKey,
  maintenanceState,
  setFeatureBody,
  setupImportBody,
} from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../identity/auth.context.js';
import { RequireStepUp } from '../identity/step-up.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { AnnouncementsService } from '../controls/announcements.service.js';
import { FeaturesService } from '../controls/features.service.js';
import { MaintenanceService } from '../controls/maintenance.service.js';
import { TenantTransferService } from '../controls/tenant-transfer.service.js';
import { UsageService } from '../controls/usage.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import {
  PlatformGuard,
  RequirePlatformPermission,
  type PlatformRequest,
} from './platform.guard.js';

const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

/** Super admin: announcements, maintenance, feature switches, usage, and setup export and import (D-70). */
@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformControlsController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly maintenance: MaintenanceService,
    private readonly features: FeaturesService,
    private readonly usage: UsageService,
    private readonly transfer: TenantTransferService,
    private readonly audit: PlatformAuditService,
  ) {}

  private note(
    req: PlatformRequest,
    action: string,
    entityType: string,
    meta?: Record<string, unknown>,
    tenantId?: string,
  ) {
    return this.audit.record({
      actorId: req.platformAuth!.platformUserId,
      action,
      entityType,
      meta,
      ip: req.ip,
      tenantId,
    });
  }

  // Announcements
  @RequirePlatformPermission('platform.controls')
  @Get('announcements')
  listAnnouncements() {
    return this.announcements.list();
  }

  @RequirePlatformPermission('platform.controls')
  @Post('announcements')
  async createAnnouncement(
    @Body(body(announcementBody)) b: z.infer<typeof announcementBody>,
    @Req() req: PlatformRequest,
  ) {
    const v = await this.announcements.create(
      b,
      req.platformAuth!.platformUserId,
    );
    await this.note(req, 'platform.announcement_created', 'announcements', {
      tone: b.tone,
      everyone: !b.tenantIds,
    });
    return v;
  }

  @RequirePlatformPermission('platform.controls')
  @Put('announcements/:id')
  async updateAnnouncement(
    @Param('id') id: string,
    @Body(body(announcementBody)) b: z.infer<typeof announcementBody>,
    @Req() req: PlatformRequest,
  ) {
    const v = await this.announcements.update(id, b);
    await this.note(req, 'platform.announcement_changed', 'announcements', {
      id,
    });
    return v;
  }

  @RequirePlatformPermission('platform.controls')
  @Delete('announcements/:id')
  @HttpCode(204)
  async removeAnnouncement(
    @Param('id') id: string,
    @Req() req: PlatformRequest,
  ) {
    await this.announcements.remove(id);
    await this.note(req, 'platform.announcement_removed', 'announcements', {
      id,
    });
  }

  // Maintenance
  @RequirePlatformPermission('platform.controls')
  @Get('maintenance')
  maintenanceState() {
    return this.maintenance.state();
  }

  @RequirePlatformPermission('platform.controls')
  @Put('maintenance')
  async setMaintenance(
    @Body(body(maintenanceState)) b: z.infer<typeof maintenanceState>,
    @Req() req: PlatformRequest,
  ) {
    await this.maintenance.set(b);
    await this.note(req, 'platform.maintenance_changed', 'system', {
      enabled: b.enabled,
      until: b.until,
    });
    return this.maintenance.state();
  }

  // Feature switches
  @RequirePlatformPermission('tenants.read')
  @Get('tenants/:id/features')
  featureState(@Param('id') id: string) {
    return this.features.state(id);
  }

  @RequirePlatformPermission('tenants.manage')
  @Put('tenants/:id/features/:key')
  async setFeature(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(body(setFeatureBody)) b: z.infer<typeof setFeatureBody>,
    @Req() req: PlatformRequest,
  ) {
    const k = featureKey.parse(key);
    await this.features.set(id, k, b.enabled, req.platformAuth!.platformUserId);
    await this.note(
      req,
      'platform.feature_changed',
      'tenant_features',
      { feature: k, enabled: b.enabled },
      id,
    );
    return this.features.state(id);
  }

  // Usage
  @RequirePlatformPermission('tenants.read')
  @Get('usage')
  usageOverview() {
    return this.usage.overview();
  }

  @RequirePlatformPermission('tenants.read')
  @Get('tenants/:id/usage')
  usageDetail(@Param('id') id: string) {
    return this.usage.detail(id);
  }

  @RequirePlatformPermission('tenants.manage')
  @HttpCode(200)
  @Post('usage/refresh')
  async refreshUsage() {
    return { companies: await this.usage.snapshotAll() };
  }

  // Export and import
  @RequirePlatformPermission('tenants.manage')
  @Get('tenants/:id/export')
  async export(@Param('id') id: string, @Req() req: PlatformRequest) {
    const out = await this.transfer.export(id);
    await this.note(req, 'platform.setup_exported', 'tenants', undefined, id);
    return out;
  }

  /** What importing would change. Nothing is saved. */
  @RequirePlatformPermission('tenants.manage')
  @HttpCode(200)
  @Post('tenants/:id/import/preview')
  preview(
    @Param('id') id: string,
    @Body(body(setupImportBody)) b: z.infer<typeof setupImportBody>,
  ) {
    return this.transfer.import(id, null, b.file, true);
  }

  @RequirePlatformPermission('tenants.manage')
  @RequireStepUp()
  @HttpCode(200)
  @Post('tenants/:id/import')
  async apply(
    @Param('id') id: string,
    @Body(body(setupImportBody)) b: z.infer<typeof setupImportBody>,
    @Req() req: PlatformRequest,
  ) {
    const r = await this.transfer.import(
      id,
      req.platformAuth!.platformUserId,
      b.file,
      false,
    );
    await this.note(
      req,
      'platform.setup_imported',
      'tenants',
      { changes: r.changes.length, from: b.file.source.slug },
      id,
    );
    return r;
  }
}
