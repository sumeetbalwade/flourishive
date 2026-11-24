import type { UsageOverview, UsagePoint } from '@flourishive/schemas';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';

const dayOf = (d: Date) => new Date(d.toISOString().slice(0, 10));

const toPoint = (r: {
  day: Date;
  users: number;
  activeUsers30d: number;
  people: number;
  lettersMonth: number;
  storageBytes: bigint;
  emailsSent: number;
  lastActivityAt: Date | null;
}): UsagePoint => ({
  day: r.day.toISOString().slice(0, 10),
  users: r.users,
  activeUsers30d: r.activeUsers30d,
  people: r.people,
  lettersMonth: r.lettersMonth,
  storageBytes: Number(r.storageBytes),
  emailsSent: r.emailsSent,
  lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
});

/** The nightly usage snapshot and what the platform usage overview shows (D-70). */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Writes today's row for one company (replacing an earlier one from the same day). */
  async snapshotTenant(tenantId: string, now = new Date()): Promise<void> {
    const day = dayOf(now);
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const data = await runInTenant(tenantId, async () => {
      const db = this.prisma.db;
      const [users, active, people, letters, files, mails, last] =
        await Promise.all([
          db.user.count({ where: { status: { not: 'DISABLED' } } }),
          db.user.count({ where: { lastLoginAt: { gte: since30 } } }),
          db.person.count(),
          db.generatedDocument.count({
            where: { createdAt: { gte: monthStart } },
          }),
          db.file.aggregate({ _sum: { sizeBytes: true } }),
          db.mailDelivery.count({
            where: { status: 'SENT', createdAt: { gte: monthStart } },
          }),
          db.auditLog.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);
      return {
        users,
        activeUsers30d: active,
        people,
        lettersMonth: letters,
        storageBytes: BigInt(files._sum.sizeBytes ?? 0),
        emailsSent: mails,
        lastActivityAt: last?.createdAt ?? null,
      };
    });
    await runInTenant(tenantId, async () =>
      this.prisma.db.tenantUsageDaily.upsert({
        where: { tenantId_day: { tenantId, day } },
        update: data,
        create: { tenantId, day, ...data },
      }),
    );
  }

  async snapshotAll(now = new Date()): Promise<number> {
    const tenants = await runAsSystem(async () =>
      this.prisma.db.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, slug: true },
      }),
    );
    for (const t of tenants.filter((x) => !x.slug.startsWith('_')))
      await this.snapshotTenant(t.id, now);
    return tenants.filter((x) => !x.slug.startsWith('_')).length;
  }

  /** Once a night (around 02:00), guarded by a Redis key so repeated worker runs do not repeat it. */
  async nightly(now = new Date()): Promise<number> {
    if (now.getHours() !== 2) return 0;
    const key = `usage:snapshot:${now.toISOString().slice(0, 10)}`;
    if ((await this.redis.client.set(key, '1', 'EX', 86_400, 'NX')) !== 'OK')
      return 0;
    return this.snapshotAll(now);
  }

  async overview(): Promise<UsageOverview> {
    const tenants = (
      await runAsSystem(async () =>
        this.prisma.db.tenant.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, slug: true, name: true },
        }),
      )
    ).filter((t) => !t.slug.startsWith('_'));
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await runAsSystem(async () =>
      this.prisma.db.tenantUsageDaily.findMany({
        where: { day: { gte: dayOf(since) } },
        orderBy: { day: 'asc' },
      }),
    );
    return {
      tenants: tenants.map((t) => {
        const mine = rows.filter((r) => r.tenantId === t.id);
        const last = mine[mine.length - 1];
        return {
          tenantId: t.id,
          slug: t.slug,
          name: t.name,
          latest: last ? toPoint(last) : null,
          trend: mine.map((r) => r.activeUsers30d),
        };
      }),
    };
  }

  async detail(tenantId: string): Promise<{ points: UsagePoint[] }> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantUsageDaily.findMany({
        orderBy: { day: 'asc' },
        take: 90,
      }),
    );
    return { points: rows.map(toPoint) };
  }
}
