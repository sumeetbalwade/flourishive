import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FieldDef } from '@flourishive/schemas';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { BUILT_IN, placeholdersIn } from './fill.js';
import { LAYOUTS } from './layouts/registry.js';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

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
            kind: 'CODED',
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
