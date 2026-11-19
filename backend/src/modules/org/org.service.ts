import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';

export { ORG_KINDS, type OrgKind } from '@flourishive/schemas';
import type { OrgKind } from '@flourishive/schemas';

interface CatalogDelegate {
  findMany(args: object): Promise<unknown[]>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
  delete(args: object): Promise<unknown>;
  findUnique(
    args: object,
  ): Promise<{ id: string; _count: { engagements: number } } | null>;
}

/** Locations, departments and designations share the same shape of operations. */
@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(kind: OrgKind): CatalogDelegate {
    const db = this.prisma.db as unknown as Record<string, CatalogDelegate>;
    return db[
      {
        locations: 'location',
        departments: 'department',
        designations: 'designation',
      }[kind]
    ]!;
  }

  /** The legal companies inside the tenant (needed to pick one when adding a person). */
  entities(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.entity.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, legalName: true },
      }),
    );
  }

  list(tenantId: string, kind: OrgKind) {
    return runInTenant(tenantId, async () =>
      this.delegate(kind).findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { engagements: true } } },
      }),
    );
  }

  create(tenantId: string, kind: OrgKind, data: Record<string, unknown>) {
    return runInTenant(tenantId, async () => {
      try {
        return await this.delegate(kind).create({
          data: { ...data, tenantId },
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002')
          throw new ConflictException('That name already exists');
        throw e;
      }
    });
  }

  update(
    tenantId: string,
    kind: OrgKind,
    id: string,
    data: Record<string, unknown>,
  ) {
    return runInTenant(tenantId, async () => {
      try {
        return await this.delegate(kind).update({ where: { id }, data });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'P2025') throw new NotFoundException();
        if (code === 'P2002')
          throw new ConflictException('That name already exists');
        throw e;
      }
    });
  }

  remove(tenantId: string, kind: OrgKind, id: string): Promise<void> {
    return runInTenant(tenantId, async () => {
      const row = await this.delegate(kind).findUnique({
        where: { id },
        include: { _count: { select: { engagements: true } } },
      });
      if (!row) throw new NotFoundException();
      if (row._count.engagements > 0)
        throw new ConflictException(
          'It is still used by people; reassign them first',
        );
      await this.delegate(kind).delete({ where: { id } });
    });
  }
}
