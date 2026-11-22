import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FieldDef } from '@flourishive/schemas';
import { FilesService } from '../files/files.service.js';
import { inspectPdf, type PdfFormField } from './pdf-forms.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { BUILT_IN, placeholdersIn } from './fill.js';
import { LAYOUTS } from './layouts/registry.js';
import { STARTER_TEMPLATES } from './starters.js';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  layouts() {
    return Object.values(LAYOUTS).map((l) => ({
      key: l.key,
      label: l.label,
      orientation: l.orientation,
      defaultContent: l.defaultContent,
      defaultFields: l.defaultFields,
    }));
  }

  /** Checks the wording against the layout and that every {{placeholder}} has a field. */
  private check(
    layoutKey: string,
    content: Record<string, unknown> | undefined,
    fields: FieldDef[] | undefined,
  ) {
    const layout = LAYOUTS[layoutKey];
    if (!layout) throw new BadRequestException('Unknown layout');
    const parsed = layout.contentSchema.safeParse({
      ...layout.defaultContent,
      ...content,
    });
    if (!parsed.success)
      throw new BadRequestException(
        `Invalid text: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    const fieldDefs = fields ?? layout.defaultFields;
    const keys = new Set(fieldDefs.map((f) => f.key));
    if (keys.size !== fieldDefs.length)
      throw new BadRequestException('Field names must be unique');
    const unknown = Object.values(parsed.data)
      .flatMap(placeholdersIn)
      .filter(
        (k) => !keys.has(k) && !(BUILT_IN as readonly string[]).includes(k),
      );
    if (unknown.length)
      throw new BadRequestException(
        `No field defined for: ${[...new Set(unknown)].join(', ')}`,
      );
    return { layout, content: parsed.data, fields: fieldDefs };
  }

  list(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.template.findMany({
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      }),
    );
  }

  /**
   * Path C: an uploaded PDF becomes a template. A plain PDF goes straight to signing as it is; a fillable
   * PDF gets one detail per form field, which HR can rename or drop before issuing.
   */
  async createFromPdf(
    a: { tenantId: string; userId: string },
    b: { name: string; letterType: string; body: Buffer },
  ) {
    const info = await inspectPdf(b.body);
    const file = await this.files.storeTrusted(a, {
      body: b.body,
      mimeType: 'application/pdf',
      name: `${b.name}.pdf`,
      ownerType: 'template',
    });
    const used = new Set<string>();
    const fields: FieldDef[] = [];
    const mapping: Record<string, string> = {};
    for (const f of info.fields) {
      let key = f.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 36) || 'field';
      if (!/^[a-zA-Z]/.test(key)) key = `f${key}`;
      while (used.has(key)) key = `${key.slice(0, 36)}x`;
      used.add(key);
      mapping[f.name] = key;
      fields.push({
        key,
        label: f.name.slice(0, 80),
        type: 'text',
        required: false,
      });
    }
    try {
      return await runInTenant(a.tenantId, async () =>
        this.prisma.db.template.create({
          data: {
            tenantId: a.tenantId,
            name: b.name,
            letterType: b.letterType,
            kind: 'PDF_UPLOAD',
            createdBy: a.userId,
            versions: {
              create: {
                tenantId: a.tenantId,
                version: 1,
                orientation: info.landscape ? 'LANDSCAPE' : 'PORTRAIT',
                content: {
                  fileId: file.id,
                  pdfFields: info.fields,
                  mapping,
                },
                fields,
                createdBy: a.userId,
              },
            },
          },
          include: { versions: true },
        }),
      );
    } catch (e) {
      await this.files.remove(a.tenantId, file.id).catch(() => undefined);
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A template with that name exists');
      throw e;
    }
  }

  /** Edits to an uploaded-PDF template: which details are asked for and which form field each fills. */
  private async addPdfVersion(
    a: { tenantId: string; userId: string },
    id: string,
    last: {
      version: number;
      orientation: 'PORTRAIT' | 'LANDSCAPE';
      content: unknown;
      fields: unknown;
    },
    b: { content?: Record<string, unknown>; fields?: FieldDef[] },
  ) {
    const prev = last.content as {
      fileId: string;
      pdfFields: PdfFormField[];
      mapping: Record<string, string>;
    };
    const fields = b.fields ?? (last.fields as unknown as FieldDef[]);
    const mapping =
      (b.content?.mapping as Record<string, string> | undefined) ??
      prev.mapping;
    const keys = new Set(fields.map((f) => f.key));
    if (keys.size !== fields.length)
      throw new BadRequestException('Field names must be unique');
    const names = new Set(prev.pdfFields.map((f) => f.name));
    for (const [pdfName, key] of Object.entries(mapping)) {
      if (!names.has(pdfName))
        throw new BadRequestException(`The PDF has no form field "${pdfName}"`);
      if (!keys.has(key) && !(BUILT_IN as readonly string[]).includes(key))
        throw new BadRequestException(`No detail defined for "${key}"`);
    }
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.templateVersion.create({
        data: {
          tenantId: a.tenantId,
          templateId: id,
          version: last.version + 1,
          orientation: last.orientation,
          content: { ...prev, mapping },
          fields,
          createdBy: a.userId,
        },
      }),
    );
  }

  /** Adds any of the four starter letters this company does not have yet. Safe to repeat. */
  async installStarters(a: { tenantId: string; userId: string }) {
    const have = new Set(
      (
        await runInTenant(a.tenantId, async () =>
          this.prisma.db.template.findMany({ select: { name: true } }),
        )
      ).map((t) => t.name),
    );
    const added: string[] = [];
    for (const s of STARTER_TEMPLATES) {
      if (have.has(s.name)) continue;
      await this.create(a, s);
      added.push(s.name);
    }
    return { added };
  }

  async get(tenantId: string, id: string) {
    const t = await runInTenant(tenantId, async () =>
      this.prisma.db.template.findUnique({
        where: { id },
        include: { versions: { orderBy: { version: 'desc' } } },
      }),
    );
    if (!t) throw new NotFoundException();
    return t;
  }

  async create(
    a: { tenantId: string; userId: string },
    b: {
      name: string;
      letterType: string;
      layoutKey: string;
      content?: Record<string, unknown>;
      fields?: FieldDef[];
    },
  ) {
    const c = this.check(b.layoutKey, b.content, b.fields);
    try {
      return await runInTenant(a.tenantId, async () =>
        this.prisma.db.template.create({
          data: {
            tenantId: a.tenantId,
            name: b.name,
            letterType: b.letterType,
            kind: c.layout.key.startsWith('editor') ? 'EDITOR' : 'CODED',
            createdBy: a.userId,
            versions: {
              create: {
                tenantId: a.tenantId,
                version: 1,
                orientation: c.layout.orientation,
                layoutKey: c.layout.key,
                content: c.content,
                fields: c.fields,
                createdBy: a.userId,
              },
            },
          },
          include: { versions: true },
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A template with that name exists');
      throw e;
    }
  }

  /** Editing never changes a saved version; it adds the next one. */
  async addVersion(
    a: { tenantId: string; userId: string },
    id: string,
    b: { content?: Record<string, unknown>; fields?: FieldDef[] },
  ) {
    const t = await this.get(a.tenantId, id);
    if (t.archivedAt) throw new ConflictException('The template is archived');
    const last = t.versions[0]!;
    if (t.kind === 'PDF_UPLOAD') return this.addPdfVersion(a, id, last, b);
    const c = this.check(
      last.layoutKey!,
      b.content ?? (last.content as Record<string, unknown>),
      b.fields ?? (last.fields as unknown as FieldDef[]),
    );
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.templateVersion.create({
        data: {
          tenantId: a.tenantId,
          templateId: id,
          version: last.version + 1,
          orientation: last.orientation,
          layoutKey: last.layoutKey,
          content: c.content,
          fields: c.fields,
          createdBy: a.userId,
        },
      }),
    );
  }

  async archive(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return runInTenant(tenantId, async () =>
      this.prisma.db.template.update({
        where: { id },
        data: { archivedAt: new Date() },
      }),
    );
  }
}
