import {
  BadRequestException,
  ConflictException,
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
import { AccessService } from '../access/access.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { DocAccess, type Actor } from './doc-access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from '../files/files.service.js';
import { LETTER_FLOW_KEY } from '../workflow/definition.js';
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
    private readonly docAccess: DocAccess,
    private readonly access: AccessService,
    private readonly workflow: WorkflowService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async generate(
    a: { tenantId: string; userId: string },
    b: GenerateBody,
    now = new Date(),
  ) {
    await this.docAccess.assert(a, 'documents.generate', b.entityId);
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
    const verifyToken = randomBytes(16).toString('hex');
    const built = await this.build(a, {
      version,
      layout,
      lh,
      values,
      reference,
      verifyToken,
      now,
    });
    const { file, bytes, pageCount } = built;
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
    await this.workflow.start(a, LETTER_FLOW_KEY, {
      type: 'document',
      id: doc.id,
    });
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

  /** Draws the letter, puts it on the letterhead, stamps it and stores the file. */
  private async build(
    a: Actor,
    p: {
      version: {
        id: string;
        content: unknown;
        orientation: 'PORTRAIT' | 'LANDSCAPE';
      };
      layout: (typeof LAYOUTS)[string];
      lh: NonNullable<Awaited<ReturnType<LetterheadsService['latest']>>>;
      values: Record<string, string>;
      reference: string;
      verifyToken: string;
      now: Date;
    },
  ) {
    const { version, layout, lh, values, reference, verifyToken, now } = p;
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
    return { file, bytes, pageCount };
  }

  private async visible(a: Actor, id: string) {
    const doc = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({ where: { id } }),
    );
    if (
      !doc ||
      !(await this.access.can(
        a.tenantId,
        a.userId,
        'documents.read',
        doc.entityId,
      ))
    )
      throw new NotFoundException();
    return doc;
  }

  async history(a: Actor, id: string) {
    await this.visible(a, id);
    return this.workflow.history(a.tenantId, { type: 'document', id });
  }

  /** Submit, approve, ask for changes or cancel. The flow decides who may do what and when. */
  async act(a: Actor, id: string, action: string, comment?: string | null) {
    const doc = await this.visible(a, id);
    const r = await this.workflow.act(a, { type: 'document', id }, action, {
      comment,
      can: (p) =>
        this.access.can(a.tenantId, a.userId, p as never, doc.entityId),
    });
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: `document.${action}`,
      entityType: 'document',
      entityId: id,
      meta: { reference: doc.reference, from: r.from, to: r.to },
    });
    return r;
  }

  /**
   * Redraws a draft with new values, keeping its reference and QR. Allowed only before approval,
   * so nothing changes once a document is approved or being signed. The earlier file is kept.
   */
  async revise(
    a: Actor,
    id: string,
    fields: Record<string, string>,
    now = new Date(),
  ) {
    const doc = await this.visible(a, id);
    await this.docAccess.assert(a, 'documents.generate', doc.entityId);
    const { state } = await this.workflow.history(a.tenantId, {
      type: 'document',
      id,
    });
    if (!['draft', 'changes_requested'].includes(state))
      throw new ConflictException('Only a draft can be changed');
    const { version, lh } = await runInTenant(a.tenantId, async () => ({
      version: await this.prisma.db.templateVersion.findUniqueOrThrow({
        where: { id: doc.templateVersionId },
      }),
      lh: await this.prisma.db.letterhead.findUniqueOrThrow({
        where: { id: doc.letterheadId },
      }),
    }));
    const layout = LAYOUTS[version.layoutKey ?? ''];
    if (!layout) throw new BadRequestException('The layout is not available');
    const { values, errors } = resolveValues(
      version.fields as unknown as FieldDef[],
      fields,
    );
    if (errors.length) throw new BadRequestException(errors);
    const built = await this.build(a, {
      version,
      layout,
      lh,
      values,
      reference: doc.reference,
      verifyToken: doc.verifyToken,
      now,
    });
    const updated = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.update({
        where: { id },
        data: {
          data: values,
          fileId: built.file.id,
          sha256: createHash('sha256').update(built.bytes).digest('hex'),
          pageCount: built.pageCount,
        },
      }),
    );
    await this.workflow.note(a, { type: 'document', id }, 'revise');
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'document.revise',
      entityType: 'document',
      entityId: id,
      meta: { reference: doc.reference },
    });
    return updated;
  }

  async list(
    a: Actor,
    q: { page: number; pageSize: number; personId?: string },
  ) {
    const scope = await this.docAccess.entityFilter(a, 'documents.read');
    return runInTenant(a.tenantId, async () => {
      const where = {
        ...scope,
        ...(q.personId ? { personId: q.personId } : {}),
      };
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
      const states = await this.workflow.statesFor(
        a.tenantId,
        'document',
        items.map((i) => i.id),
      );
      const personIds = [
        ...new Set(
          items.map((i) => i.personId).filter((x): x is string => !!x),
        ),
      ];
      const people = personIds.length
        ? await this.prisma.db.person.findMany({
            where: { id: { in: personIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const names = new Map(
        people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
      );
      return {
        items: items.map((i) => ({
          ...i,
          personName: i.personId ? (names.get(i.personId) ?? null) : null,
          state: states.get(i.id) ?? null,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async get(a: Actor, id: string) {
    const doc = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({ where: { id } }),
    );
    if (!doc) throw new NotFoundException();
    // A company the caller cannot see is reported as not found, not as forbidden.
    if (
      !(await this.access.can(
        a.tenantId,
        a.userId,
        'documents.read',
        doc.entityId,
      ))
    )
      throw new NotFoundException();
    const link = await this.files.linkFor(a.tenantId, doc.fileId);
    const workflow = await this.workflow.available(
      a.tenantId,
      { type: 'document', id },
      (p) => this.access.can(a.tenantId, a.userId, p as never, doc.entityId),
    );
    const person = doc.personId
      ? await runInTenant(a.tenantId, async () =>
          this.prisma.db.person.findUnique({
            where: { id: doc.personId! },
            select: {
              firstName: true,
              lastName: true,
              workEmail: true,
              personalEmail: true,
            },
          }),
        )
      : null;
    return {
      ...doc,
      personName: person
        ? `${person.firstName} ${person.lastName}`.trim()
        : null,
      personEmail: person?.personalEmail ?? person?.workEmail ?? null,
      workflow,
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
