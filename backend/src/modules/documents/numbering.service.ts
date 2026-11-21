import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { formatReference } from './numbering.js';

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.numberingScheme.findMany({
        orderBy: [{ entityId: 'asc' }, { letterType: 'asc' }],
      }),
    );
  }

  /** Creates or changes the format for one entity and letter type. */
  save(
    tenantId: string,
    b: {
      entityId: string;
      letterType: string;
      format: string;
      startAt: number;
    },
  ) {
    return runInTenant(tenantId, async () => {
      const entity = await this.prisma.db.entity.findUnique({
        where: { id: b.entityId },
        select: { id: true },
      });
      if (!entity) throw new BadRequestException('That company does not exist');
      return this.prisma.db.numberingScheme.upsert({
        where: {
          tenantId_entityId_letterType: {
            tenantId,
            entityId: b.entityId,
            letterType: b.letterType,
          },
        },
        create: { tenantId, ...b },
        update: { format: b.format, startAt: b.startAt },
      });
    });
  }

  /**
   * Hands out the next reference. The counter only ever goes up, and the update locks its row,
   * so two requests at once get different numbers. A number is never handed out twice; if the
   * document that used it later fails, that number is simply skipped.
   */
  async next(
    tenantId: string,
    entityId: string,
    letterType: string,
    now = new Date(),
  ): Promise<string> {
    const year = now.getUTCFullYear();
    const period = String(year);
    return runInTenant(tenantId, async () => {
      const scheme = await this.prisma.db.numberingScheme.findUnique({
        where: {
          tenantId_entityId_letterType: { tenantId, entityId, letterType },
        },
      });
      if (!scheme)
        throw new BadRequestException(
          'Set up reference numbering for this company and letter type first',
        );
      const seq = await this.prisma.db.$transaction(async (tx) => {
        const where = { schemeId_period: { schemeId: scheme.id, period } };
        const existing = await tx.numberingCounter.findUnique({ where });
        if (!existing) {
          try {
            await tx.numberingCounter.create({
              data: {
                tenantId,
                schemeId: scheme.id,
                period,
                lastSeq: scheme.startAt,
              },
            });
            return scheme.startAt;
          } catch (e) {
            if ((e as { code?: string }).code !== 'P2002') throw e;
          }
        }
        const row = await tx.numberingCounter.update({
          where,
          data: { lastSeq: { increment: 1 } },
        });
        return row.lastSeq;
      });
      return formatReference(scheme.format, year, seq);
    });
  }
}
