import {
  type ActiveAnnouncement,
  type AnnouncementBody,
  type AnnouncementView,
} from '@flourishive/schemas';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';

const toView = (r: {
  id: string;
  message: string;
  tone: 'INFO' | 'WARNING' | 'CRITICAL';
  tenantIds: unknown;
  startsAt: Date;
  endsAt: Date;
  dismissible: boolean;
  createdAt: Date;
}): AnnouncementView => ({
  id: r.id,
  message: r.message,
  tone: r.tone,
  tenantIds: Array.isArray(r.tenantIds) ? (r.tenantIds as string[]) : null,
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt.toISOString(),
  dismissible: r.dismissible,
  createdAt: r.createdAt.toISOString(),
});

/** Banners the platform shows above every page for a while (D-70). */
@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AnnouncementView[]> {
    const rows = await runAsSystem(async () =>
      this.prisma.db.announcement.findMany({ orderBy: { startsAt: 'desc' } }),
    );
    return rows.map(toView);
  }

  async create(b: AnnouncementBody, by: string): Promise<AnnouncementView> {
    const row = await runAsSystem(async () =>
      this.prisma.db.announcement.create({
        data: {
          message: b.message,
          tone: b.tone,
          tenantIds: b.tenantIds ?? undefined,
          startsAt: new Date(b.startsAt),
          endsAt: new Date(b.endsAt),
          dismissible: b.dismissible,
          createdBy: by,
        },
      }),
    );
    return toView(row);
  }

  async update(id: string, b: AnnouncementBody): Promise<AnnouncementView> {
    const found = await runAsSystem(async () =>
      this.prisma.db.announcement.findUnique({ where: { id } }),
    );
    if (!found) throw new NotFoundException('Announcement not found');
    const row = await runAsSystem(async () =>
      this.prisma.db.announcement.update({
        where: { id },
        data: {
          message: b.message,
          tone: b.tone,
          tenantIds: b.tenantIds ?? (null as never),
          startsAt: new Date(b.startsAt),
          endsAt: new Date(b.endsAt),
          dismissible: b.dismissible,
        },
      }),
    );
    return toView(row);
  }

  async remove(id: string): Promise<void> {
    const n = await runAsSystem(async () =>
      this.prisma.db.announcement.deleteMany({ where: { id } }),
    );
    if (n.count === 0) throw new NotFoundException('Announcement not found');
  }

  /** What this company's people see right now, most serious first. */
  async activeFor(
    tenantId: string,
    now = new Date(),
  ): Promise<ActiveAnnouncement[]> {
    const rows = await runAsSystem(async () =>
      this.prisma.db.announcement.findMany({
        where: { startsAt: { lte: now }, endsAt: { gt: now } },
      }),
    );
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    return rows
      .filter((r) => {
        const ids = r.tenantIds;
        return !Array.isArray(ids) || (ids as string[]).includes(tenantId);
      })
      .sort((a, b) => rank[a.tone] - rank[b.tone])
      .map((r) => ({
        id: r.id,
        message: r.message,
        tone: r.tone,
        dismissible: r.dismissible,
      }));
  }
}
