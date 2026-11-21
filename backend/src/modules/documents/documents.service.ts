import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FieldDef, GenerateBody } from '@flourishive/schemas';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { StorageService } from '../../platform/storage/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from '../files/files.service.js';
import { fill, longDate, resolveValues } from './fill.js';
import { LAYOUTS } from './layouts/registry.js';
import { LetterheadsService } from './letterheads.service.js';
import { NumberingService } from './numbering.service.js';
import { PdfService } from './pdf.service.js';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly letterheads: LetterheadsService,
    private readonly numbering: NumberingService,
    private readonly pdf: PdfService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async generate(
    a: { tenantId: string; userId: string },
    b: GenerateBody,
    now = new Date(),
  ) {
    const { template, entity, person, engagement } = await runInTenant(
      a.tenantId,
      async () => ({
        template: await this.prisma.db.template.findUnique({
          where: { id: b.templateId },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        }),
        entity: await this.prisma.db.entity.findUnique({
          where: { id: b.entityId },
          select: { id: true },
        }),
        person: b.personId
          ? await this.prisma.db.person.findUnique({
              where: { id: b.personId },
              select: { id: true },
            })
          : true,
        engagement: b.engagementId
          ? await this.prisma.db.engagement.findUnique({
              where: { id: b.engagementId },
              select: { id: true },
            })
          : true,
      }),
    );
    if (!template || template.archivedAt)
      throw new NotFoundException('Template not found');
    if (!entity) throw new BadRequestException('That company does not exist');
    if (!person) throw new BadRequestException('That person does not exist');
    if (!engagement)
      throw new BadRequestException('That engagement does not exist');
    const version = template.versions[0]!;
    const layout = LAYOUTS[version.layoutKey ?? ''];
    if (!layout) throw new BadRequestException('The layout is not available');

    const lh = await this.letterheads.latest(
      a.tenantId,
      b.entityId,
      version.orientation,
    );
    if (!lh)
      throw new BadRequestException(
        `Upload a ${version.orientation.toLowerCase()} letterhead for this company first`,
      );

    const { values, errors } = resolveValues(
      version.fields as unknown as FieldDef[],
      b.fields,
    );
    if (errors.length) throw new BadRequestException(errors);

    // The number is taken only after the inputs are known good, so mistakes do not burn numbers.
    const reference = await this.numbering.next(
      a.tenantId,
      b.entityId,
      template.letterType,
      now,
    );
    const all = { ...values, reference, issueDate: longDate(now) };
    const content = Object.fromEntries(
      Object.entries(version.content as Record<string, string>).map(
        ([k, v]) => [k, fill(v, all)],
      ),
    );
    const margins = {
      top: lh.marginTop,
      bottom: lh.marginBottom,
      left: lh.marginLeft,
      right: lh.marginRight,
    };
    const verifyToken = randomBytes(16).toString('hex');
    const body = await this.pdf.renderBody(layout, {
      content: { ...content, reference, issueDate: all.issueDate },
      orientation: version.orientation,
      margins,
    });
    const letterheadFile = await this.files.get(a.tenantId, lh.fileId);
    const lhBytes = await readAll(this.storage.read(letterheadFile.storageKey));
    const { bytes, pageCount } = await this.pdf.compose({
      body,
      letterhead: lhBytes,
      reference,
      verifyUrl: `${this.config.VERIFY_URL.replace(/\/$/, '')}/d/${verifyToken}`,
      margins,
      stamp: { left: lh.stampLeft, bottom: lh.stampBottom },
    });
    const file = await this.files.storeTrusted(a, {
      body: bytes,
      mimeType: 'application/pdf',
      name: `${reference.replaceAll('/', '-')}.pdf`,
      ownerType: 'document',
    });
    const doc = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.create({
        data: {
          tenantId: a.tenantId,
          entityId: b.entityId,
          templateVersionId: version.id,
          letterheadId: lh.id,
          letterType: template.letterType,
          reference,
          verifyToken,
          personId: b.personId ?? null,
          engagementId: b.engagementId ?? null,
          data: values,
          fileId: file.id,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          pageCount,
          createdBy: a.userId,
        },
      }),
    );
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'document.generate',
      entityType: 'document',
      entityId: doc.id,
      meta: { reference, letterType: template.letterType },
    });
    return doc;
  }

  async list(
    tenantId: string,
    q: { page: number; pageSize: number; personId?: string },
  ) {
    return runInTenant(tenantId, async () => {
      const where = q.personId ? { personId: q.personId } : {};
      const [items, total] = await Promise.all([
        this.prisma.db.generatedDocument.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          omit: { verifyToken: true, data: true },
        }),
        this.prisma.db.generatedDocument.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(tenantId: string, id: string) {
    const doc = await runInTenant(tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({ where: { id } }),
    );
    if (!doc) throw new NotFoundException();
    const link = await this.files.linkFor(tenantId, doc.fileId);
    return {
      ...doc,
      downloadUrl: link.url,
      downloadUrlExpiresAt: link.expiresAt,
    };
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}
