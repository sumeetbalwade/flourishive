import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DeliveriesResponse, DeliveryQuery } from '@flourishive/schemas';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';

/** The email log (D-60): what was sent, what failed and why, with Resend. */
@Injectable()
export class MailDeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** `tenantId` pins a company admin to their own mail; the platform may pass any or none. */
  async list(
    q: DeliveryQuery,
    tenantId: string | null,
  ): Promise<DeliveriesResponse> {
    const search = q.q?.trim();
    const where = {
      ...(tenantId ? { tenantId } : q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.event ? { event: q.event } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(search
        ? search.includes('@') && !search.includes('*')
          ? {
              toHash: createHash('sha256')
                .update(search.toLowerCase())
                .digest('hex'),
            }
          : { toMasked: { contains: search } }
        : {}),
    };
    const [total, rows] = await runAsSystem(async () => [
      await this.db.mailDelivery.count({ where }),
      await this.db.mailDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const ids = [
      ...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x)),
    ];
    const names = new Map(
      (
        await runAsSystem(
          async () =>
            await this.db.tenant.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            }),
        )
      ).map((t) => [t.id, t.name]),
    );
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          tenantId: r.tenantId,
          tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null,
          event: r.event,
          to: r.toMasked,
          status: r.status,
          error: r.error,
          attempts: r.attempts,
          requestId: r.requestId,
          createdAt: r.createdAt.toISOString(),
          sentAt: r.sentAt?.toISOString() ?? null,
          canResend: r.status === 'FAILED' && (await this.mail.canResend(r.id)),
        })),
      ),
    };
  }

  /**
   * Sends a failed message again from the copy held for an hour. Older than that, the person has to
   * repeat the action (for example "Forgot password"), which issues a fresh code or link.
   */
  async resend(id: string, tenantId: string | null): Promise<void> {
    const row = await runAsSystem(
      async () =>
        await this.db.mailDelivery.findFirst({
          where: { id, ...(tenantId ? { tenantId } : {}) },
        }),
    );
    if (!row) throw new NotFoundException('No such email');
    if (row.status !== 'FAILED')
      throw new ConflictException('Only emails that failed can be sent again');
    let sent = false;
    try {
      sent = await this.mail.retry(id);
    } catch {
      const after = await runAsSystem(
        async () => await this.db.mailDelivery.findUnique({ where: { id } }),
      );
      throw new BadGatewayException(
        after?.error ?? 'The mail server did not accept the message.',
      );
    }
    if (!sent)
      throw new ConflictException(
        'This message is too old to send again. Ask the person to repeat the action, for example “Forgot password”, which sends a fresh code or link.',
      );
  }
}
