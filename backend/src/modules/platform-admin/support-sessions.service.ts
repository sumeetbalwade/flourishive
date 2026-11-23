import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { tenantUrl } from '../company/tenant-host.js';
import { TokenService } from '../identity/token.service.js';
import {
  supportPrincipalKey,
  supportSessionKey,
  type OpenSupportSession,
} from '../identity/support-keys.js';
import { PlatformRolesService } from './platform-roles.service.js';

export interface StartInput {
  reason: string;
  mode: 'READ' | 'WRITE';
  minutes: number;
}

/**
 * Platform staff looking at a company with a stated reason (D-56). View-only unless the staff member's
 * role allows changing data. Short-lived, endable at any time by staff or by the company, and recorded
 * in the company's own audit trail.
 */
@Injectable()
export class SupportSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly roles: PlatformRolesService,
    private readonly audit: AuditService,
    private readonly runtime: RuntimeConfigService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async start(
    staffId: string,
    tenantId: string,
    input: StartInput,
    ip?: string,
  ) {
    const mine = await this.roles.permissionsOf(staffId);
    const needed =
      input.mode === 'WRITE' ? 'tenants.data.write' : 'tenants.data.read';
    if (!mine.has(needed))
      throw new ForbiddenException(
        input.mode === 'WRITE'
          ? 'Your role cannot open a company in change mode'
          : 'Your role cannot open a company in support mode',
      );
    const [tenant, staff] = await Promise.all([
      runAsSystem(
        async () =>
          await this.db.tenant.findUnique({ where: { id: tenantId } }),
      ),
      runAsSystem(
        async () =>
          await this.db.platformUser.findUnique({ where: { id: staffId } }),
      ),
    ]);
    if (!tenant) throw new NotFoundException('No such company');
    if (!staff) throw new ForbiddenException();
    if (tenant.slug.startsWith('_'))
      throw new BadRequestException('That is not a company');

    // One open session per person and company: starting a new one ends the old.
    await this.endOpen(staffId, tenantId, 'replaced');

    const expiresAt = new Date(Date.now() + input.minutes * 60_000);
    const row = await runAsSystem(
      async () =>
        await this.db.supportSession.create({
          data: {
            tenantId,
            platformUserId: staffId,
            reason: input.reason,
            mode: input.mode,
            expiresAt,
          },
        }),
    );
    const open: OpenSupportSession = {
      sessionId: row.id,
      tenantId,
      platformUserId: staffId,
      staffEmail: staff.email,
      mode: input.mode,
      reason: input.reason,
      expiresAt: expiresAt.toISOString(),
    };
    const ttl = input.minutes * 60;
    await this.redis.setJson(supportSessionKey(row.id), open, ttl);
    await this.redis.client.set(
      supportPrincipalKey(tenantId, staffId),
      input.mode,
      'EX',
      ttl,
    );
    const accessToken = await this.tokens.signAccess(
      {
        userId: staffId,
        tenantId,
        sessionId: row.id,
        support: { mode: input.mode },
      },
      ttl,
    );
    await this.audit.recordSafely({
      tenantId,
      actorType: 'PLATFORM',
      actorId: staffId,
      action: 'support.session_started',
      entityType: 'support_sessions',
      entityId: row.id,
      meta: { mode: input.mode, minutes: input.minutes, reason: input.reason },
      ip,
    });
    const base = tenantUrl(
      await this.runtime.require('TENANT_URL_TEMPLATE'),
      tenant.slug,
    );
    return {
      sessionId: row.id,
      accessToken,
      expiresAt: expiresAt.toISOString(),
      mode: input.mode,
      // The token rides in the fragment, which browsers never send to a server.
      url: `${base.replace(/\/$/, '')}/#/support?token=${accessToken}`,
    };
  }

  private async close(
    id: string,
    tenantId: string,
    staffId: string,
    by: 'staff' | 'company' | 'replaced',
    ip?: string,
  ) {
    await runAsSystem(
      async () =>
        await this.db.supportSession.updateMany({
          where: { id, endedAt: null },
          data: { endedAt: new Date() },
        }),
    );
    await this.redis.del(
      supportSessionKey(id),
      supportPrincipalKey(tenantId, staffId),
    );
    await this.audit.recordSafely({
      tenantId,
      actorType: 'PLATFORM',
      actorId: staffId,
      action: 'support.session_ended',
      entityType: 'support_sessions',
      entityId: id,
      meta: { by },
      ip,
    });
  }

  private async endOpen(staffId: string, tenantId: string, by: 'replaced') {
    const rows = await runAsSystem(
      async () =>
        await this.db.supportSession.findMany({
          where: {
            platformUserId: staffId,
            tenantId,
            endedAt: null,
            expiresAt: { gt: new Date() },
          },
        }),
    );
    for (const r of rows) await this.close(r.id, tenantId, staffId, by);
  }

  /** Staff ending their own session (anyone with staff.manage can end anyone's). */
  async endByStaff(staffId: string, id: string, ip?: string) {
    const row = await runAsSystem(
      async () => await this.db.supportSession.findUnique({ where: { id } }),
    );
    if (!row) throw new NotFoundException();
    if (
      row.platformUserId !== staffId &&
      !(await this.roles.permissionsOf(staffId)).has('staff.manage')
    )
      throw new ForbiddenException('That session belongs to someone else');
    await this.close(id, row.tenantId, row.platformUserId, 'staff', ip);
  }

  /** The company ends the session it is looking at (the banner's End session button). */
  async endByCompany(tenantId: string, id: string, ip?: string) {
    const row = await runInTenant(
      tenantId,
      async () =>
        await this.db.supportSession.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException();
    await this.close(id, tenantId, row.platformUserId, 'company', ip);
  }

  /** Sessions for one company, newest first (platform console and the company's own audit screen). */
  async listFor(tenantId: string, viaTenant: boolean) {
    const find = async () =>
      await this.db.supportSession.findMany({
        where: { tenantId },
        orderBy: { startedAt: 'desc' },
        take: 100,
        include: { user: { select: { email: true } } },
      });
    const rows = viaTenant
      ? await runInTenant(tenantId, find)
      : await runAsSystem(find);
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      staff: r.user.email,
      reason: r.reason,
      mode: r.mode,
      startedAt: r.startedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      active: !r.endedAt && r.expiresAt.getTime() > now,
    }));
  }

  /** What a support principal's `me` shows. */
  async openSession(sessionId: string): Promise<OpenSupportSession | null> {
    return this.redis.getJson<OpenSupportSession>(supportSessionKey(sessionId));
  }
}
