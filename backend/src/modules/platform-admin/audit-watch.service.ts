import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { AuditService, type ChainCheck } from '../audit/audit.service.js';
import { AlertsService } from '../logs/alerts.service.js';
import {
  PLATFORM_TENANT_SLUG,
  PlatformAuditService,
} from './platform-audit.service.js';

export interface WatchResult {
  tenants: number;
  rowsChecked: number;
  broken: { slug: string; seq?: string; reason?: string }[];
}

/**
 * The nightly integrity check: re-computes every company's audit hash chain (and the platform's
 * own). A broken chain means a row was edited, removed or cut off, so every active platform
 * admin is emailed, and the finding itself goes into the platform audit log.
 */
@Injectable()
export class AuditWatchService {
  private readonly log = new Logger(AuditWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platformAudit: PlatformAuditService,
    private readonly mail: MailService,
    private readonly alerts: AlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(): Promise<WatchResult> {
    const tenants = await runAsSystem(
      async () =>
        await this.prisma.db.tenant.findMany({
          select: { id: true, slug: true },
          orderBy: { slug: 'asc' },
        }),
    );
    const result: WatchResult = {
      tenants: tenants.length,
      rowsChecked: 0,
      broken: [],
    };
    for (const t of tenants) {
      const check: ChainCheck = await this.audit.verifyChain(t.id);
      result.rowsChecked += check.checked;
      if (!check.ok)
        result.broken.push({
          slug: t.slug,
          seq: check.brokenAtSeq,
          reason: check.reason,
        });
    }
    // Recorded after the check, so tonight's own entry is not part of tonight's comparison.
    await this.platformAudit.record({
      actorId: null,
      action: result.broken.length
        ? 'platform.audit_chain_broken'
        : 'platform.audit_chain_verified',
      entityType: 'audit_log',
      meta: { ...result },
    });
    if (result.broken.length) {
      await this.alert(result);
      // People who chose to hear about it (their own company, or every company for staff).
      for (const b of result.broken) {
        const t = tenants.find((x) => x.slug === b.slug);
        if (t)
          await this.alerts.raise({
            event: 'AUDIT_CHAIN_BROKEN',
            tenantId: t.slug === PLATFORM_TENANT_SLUG ? null : t.id,
            summary: `The audit trail of ${b.slug} failed its integrity check: ${b.reason ?? 'broken'}. A row may have been edited or removed.`,
          });
      }
    }
    return result;
  }

  private async alert(result: WatchResult): Promise<void> {
    const admins = await runAsSystem(
      async () =>
        await this.prisma.db.platformUser.findMany({
          where: { status: 'ACTIVE' },
          select: { email: true },
        }),
    );
    if (admins.length === 0) {
      this.log.error('Audit chain broken but there is nobody to email');
      return;
    }
    const lines = result.broken.map(
      (b) =>
        `- ${b.slug}: ${b.reason ?? 'broken'}${b.seq ? ` (row ${b.seq})` : ''}`,
    );
    await this.mail.send({
      event: 'platform.alert',
      to: admins.map((a) => a.email),
      subject: `${this.config.APP_NAME}: audit log integrity check FAILED`,
      text: `The nightly check found a problem in the audit log of ${result.broken.length} compan${
        result.broken.length === 1 ? 'y' : 'ies'
      }:\n\n${lines.join('\n')}\n\nA row was edited, removed or cut off. Treat this as a security incident: keep the database as it is and investigate who had access.`,
    });
  }
}
