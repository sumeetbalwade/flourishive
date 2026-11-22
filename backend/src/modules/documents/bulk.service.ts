import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { BulkBody, FieldDef } from '@flourishive/schemas';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { JobRecordsService } from '../../platform/queue/job-records.service.js';
import { JobHandlerRegistry } from '../../platform/queue/job-handlers.js';
import { DocAccess, type Actor } from './doc-access.service.js';
import { DocumentsService } from './documents.service.js';
import { resolveValues } from './fill.js';

export const BULK_JOB = 'documents.bulk';

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : '';

/** Issues one template to many people as a queued job. Row by row, resumable, never numbers twice. */
@Injectable()
export class BulkService implements OnModuleInit {
  private readonly log = new Logger(BulkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docs: DocumentsService,
    private readonly docAccess: DocAccess,
    private readonly jobs: JobRecordsService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register(BULK_JOB, async (p) => {
      await this.run(
        p.tenantId as string,
        p.batchId as string,
        p.userId as string,
      );
    });
  }

  /**
   * Checks every row first. Nothing is numbered and nothing is queued unless all rows are valid,
   * so HR fixes mistakes in one go instead of finding half a batch issued.
   */
  async create(a: Actor, b: BulkBody) {
    await this.docAccess.assert(a, 'documents.generate', b.entityId);
    const { template, people, engagements } = await runInTenant(
      a.tenantId,
      async () => {
        const personIds = b.rows.flatMap((r) => r.personId ?? []);
        const engIds = b.rows.flatMap((r) => r.engagementId ?? []);
        return {
          template: await this.prisma.db.template.findUnique({
            where: { id: b.templateId },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          }),
          people: await this.prisma.db.person.findMany({
            where: { id: { in: personIds } },
          }),
          engagements: await this.prisma.db.engagement.findMany({
            where: { id: { in: engIds } },
          }),
        };
      },
    );
    if (!template || template.archivedAt)
      throw new NotFoundException('Template not found');
    const fields = template.versions[0]!.fields as unknown as FieldDef[];
    const keys = new Set(fields.map((f) => f.key));
    const personById = new Map(people.map((p) => [p.id, p]));
    const engById = new Map(engagements.map((e) => [e.id, e]));

    const errors: string[] = [];
    const merged = b.rows.map((r, i) => {
      const row = i + 1;
      const person = r.personId ? personById.get(r.personId) : undefined;
      const eng = r.engagementId ? engById.get(r.engagementId) : undefined;
      if (r.personId && !person) errors.push(`Row ${row}: person not found`);
      if (r.engagementId && !eng)
        errors.push(`Row ${row}: engagement not found`);
      // What we already know about the person fills the gaps; the form values win.
      const known: Record<string, string> = {};
      if (person)
        known.recipientName = `${person.firstName} ${person.lastName}`;
      if (eng) {
        known.startDate = iso(eng.startDate);
        known.endDate = iso(eng.endDate);
      }
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries({
        ...known,
        ...b.shared,
        ...r.fields,
      }))
        if (keys.has(k) && v !== '') values[k] = v;
      const check = resolveValues(fields, values);
      for (const e of check.errors) errors.push(`Row ${row}: ${e}`);
      return { r, values };
    });
    if (errors.length)
      throw new BadRequestException({
        message: 'Some rows need fixing. Nothing was issued.',
        errors: errors.slice(0, 50),
      });

    const batch = await runInTenant(a.tenantId, async () =>
      this.prisma.db.bulkBatch.create({
        data: {
          tenantId: a.tenantId,
          templateId: b.templateId,
          entityId: b.entityId,
          createdBy: a.userId,
          rows: {
            create: merged.map((m, i) => ({
              tenantId: a.tenantId,
              position: i + 1,
              personId: m.r.personId ?? null,
              engagementId: m.r.engagementId ?? null,
              fields: m.values,
            })),
          },
        },
      }),
    );
    await this.jobs.enqueue(a.tenantId, BULK_JOB, {
      batchId: batch.id,
      userId: a.userId,
    });
    return this.get(a, batch.id);
  }

  /** Works through the pending rows. Rows already DONE are skipped, so a re-run is harmless. */
  async run(tenantId: string, batchId: string, userId: string) {
    const batch = await runInTenant(tenantId, async () =>
      this.prisma.db.bulkBatch.findUnique({ where: { id: batchId } }),
    );
    if (!batch) return;
    const a = { tenantId, userId };
    for (;;) {
      const row = await runInTenant(tenantId, async () =>
        this.prisma.db.bulkBatchRow.findFirst({
          where: { batchId, status: 'PENDING' },
          orderBy: { position: 'asc' },
        }),
      );
      if (!row) break;
      try {
        const doc = await this.docs.generate(a, {
          templateId: batch.templateId,
          entityId: batch.entityId,
          personId: row.personId ?? undefined,
          engagementId: row.engagementId ?? undefined,
          fields: row.fields as Record<string, string>,
        });
        await this.mark(tenantId, row.id, 'DONE', { documentId: doc.id });
      } catch (e) {
        this.log.warn(`bulk row ${row.id} failed: ${(e as Error).message}`);
        await this.mark(tenantId, row.id, 'FAILED', {
          error: (e as Error).message.slice(0, 500),
        });
      }
    }
  }

  private mark(
    tenantId: string,
    id: string,
    status: 'DONE' | 'FAILED',
    extra: { documentId?: string; error?: string },
  ) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.bulkBatchRow.update({
        where: { id },
        data: { status, ...extra },
      }),
    );
  }

  async get(a: Actor, id: string) {
    const batch = await runInTenant(a.tenantId, async () =>
      this.prisma.db.bulkBatch.findUnique({
        where: { id },
        include: { rows: { orderBy: { position: 'asc' } } },
      }),
    );
    if (!batch) throw new NotFoundException();
    await this.docAccess.assert(a, 'documents.generate', batch.entityId);
    const count = (s: string) =>
      batch.rows.filter((r) => r.status === s).length;
    const docs = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.findMany({
        where: {
          id: { in: batch.rows.flatMap((r) => r.documentId ?? []) },
        },
        select: { id: true, reference: true },
      }),
    );
    const ref = new Map(docs.map((d) => [d.id, d.reference]));
    return {
      id: batch.id,
      createdAt: batch.createdAt,
      total: batch.rows.length,
      done: count('DONE'),
      failed: count('FAILED'),
      pending: count('PENDING'),
      finished: count('PENDING') === 0,
      rows: batch.rows.map((r) => ({
        position: r.position,
        status: r.status,
        documentId: r.documentId,
        reference: r.documentId ? (ref.get(r.documentId) ?? null) : null,
        error: r.error,
      })),
    };
  }
}
