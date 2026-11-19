import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';

/** Slug of the hidden tenant whose audit chain holds platform-level events. Real slugs cannot start with "_". */
export const PLATFORM_TENANT_SLUG = '_platform';

/**
 * Platform-level events (super admin sign-ins, inviting staff) have no customer tenant,
 * so they go into the same tamper-evident chain under a hidden, suspended tenant.
 */
@Injectable()
export class PlatformAuditService {
  private tenantId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async platformTenantId(): Promise<string> {
    if (this.tenantId) return this.tenantId;
    const t = await runAsSystem(
      async () =>
        await this.prisma.db.tenant.upsert({
          where: { slug: PLATFORM_TENANT_SLUG },
          update: {},
          create: {
            slug: PLATFORM_TENANT_SLUG,
            name: 'Flourishive platform',
            status: 'SUSPENDED',
          },
        }),
    );
    return (this.tenantId = t.id);
  }

  async record(e: {
    actorId: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    meta?: Record<string, unknown>;
    ip?: string;
    tenantId?: string;
  }) {
    await this.audit.recordSafely({
      tenantId: e.tenantId ?? (await this.platformTenantId()),
      actorType: 'PLATFORM',
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      meta: e.meta ?? null,
      ip: e.ip ?? null,
    });
  }
}
