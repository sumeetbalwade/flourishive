import type {
  CustomFieldBody,
  CustomFieldEntity,
  CustomFieldValuesView,
  CustomFieldView,
} from '@flourishive/schemas';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { AccessService } from '../access/access.service.js';
import { FilesService } from '../files/files.service.js';

const MAX_PER_ENTITY = 40;
const ADMIN_ROLE = 'tenant_admin';

type Def = Awaited<
  ReturnType<PrismaService['db']['customFieldDefinition']['findMany']>
>[number];

const asList = (v: unknown): string[] | null =>
  Array.isArray(v) ? (v as string[]) : null;

const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field';

/**
 * Fields a company adds to people and engagements (D-29), with role-based visibility. Tenant admins
 * always see and change every field; for everyone else the field's role lists decide.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly files: FilesService,
  ) {}

  private async roleKeys(tenantId: string, userId: string): Promise<string[]> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.userRole.findMany({
        where: { userId },
        include: { role: { select: { key: true } } },
      }),
    );
    return rows.map((r) => r.role.key);
  }

  private view(d: Def, canEdit: boolean): CustomFieldView {
    return {
      id: d.id,
      entityType: d.entityType,
      key: d.key,
      label: d.label,
      helpText: d.helpText,
      type: d.type,
      options: asList(d.options) ?? [],
      required: d.required,
      visibleToRoles: asList(d.visibleToRoles),
      editableByRoles: asList(d.editableByRoles),
      sortOrder: d.sortOrder,
      archived: d.archived,
      canEdit,
    };
  }

  private canSee(d: Def, roles: string[]): boolean {
    if (roles.includes(ADMIN_ROLE)) return true;
    const list = asList(d.visibleToRoles);
    return !list || list.some((r) => roles.includes(r));
  }

  private canChange(d: Def, roles: string[]): boolean {
    if (roles.includes(ADMIN_ROLE)) return true;
    const list = asList(d.editableByRoles);
    return !list || list.some((r) => roles.includes(r));
  }

  // Definitions ---------------------------------------------------------------------------------

  /** Managers get every field; everyone else only what their roles may see. */
  async list(
    tenantId: string,
    userId: string,
    entityType: CustomFieldEntity | undefined,
    asManager: boolean,
  ): Promise<CustomFieldView[]> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.findMany({
        where: {
          ...(entityType ? { entityType } : {}),
          ...(asManager ? {} : { archived: false }),
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    const roles = await this.roleKeys(tenantId, userId);
    return rows
      .filter((d) => asManager || this.canSee(d, roles))
      .map((d) => this.view(d, this.canChange(d, roles)));
  }

  async create(tenantId: string, b: CustomFieldBody): Promise<CustomFieldView> {
    const count = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.count({
        where: { entityType: b.entityType },
      }),
    );
    if (count >= MAX_PER_ENTITY)
      throw new BadRequestException(
        `A company can have up to ${MAX_PER_ENTITY} custom fields here`,
      );
    try {
      const d = await runInTenant(tenantId, async () =>
        this.prisma.db.customFieldDefinition.create({
          data: {
            tenantId,
            entityType: b.entityType,
            key: keyOf(b.label),
            label: b.label,
            helpText: b.helpText,
            type: b.type,
            options:
              b.type === 'SELECT' ? [...new Set(b.options)] : Prisma.DbNull,
            required: b.required,
            visibleToRoles: b.visibleToRoles ?? Prisma.DbNull,
            editableByRoles: b.editableByRoles ?? Prisma.DbNull,
            sortOrder: b.sortOrder,
          },
        }),
      );
      return this.view(d, true);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('A field with that name already exists');
      throw e;
    }
  }

  /** The type, key and kind of record cannot change once values exist, so stored values stay valid. */
  async update(
    tenantId: string,
    id: string,
    b: CustomFieldBody,
  ): Promise<CustomFieldView> {
    const d = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.findUnique({ where: { id } }),
    );
    if (!d) throw new NotFoundException();
    if (d.type !== b.type || d.entityType !== b.entityType)
      throw new BadRequestException(
        'The type and the kind of record cannot be changed. Archive this field and add a new one.',
      );
    const next = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.update({
        where: { id },
        data: {
          label: b.label,
          helpText: b.helpText,
          options:
            b.type === 'SELECT' ? [...new Set(b.options)] : Prisma.DbNull,
          required: b.required,
          visibleToRoles: b.visibleToRoles ?? Prisma.DbNull,
          editableByRoles: b.editableByRoles ?? Prisma.DbNull,
          sortOrder: b.sortOrder,
        },
      }),
    );
    return this.view(next, true);
  }

  /** Hides the field everywhere but keeps its values, so restoring it loses nothing. */
  async archive(
    tenantId: string,
    id: string,
    archived: boolean,
  ): Promise<void> {
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.updateMany({
        where: { id },
        data: { archived },
      }),
    );
    if (r.count === 0) throw new NotFoundException();
  }

  // Values --------------------------------------------------------------------------------------

  /** The caller must be able to see (or, to change, edit) the person or engagement the values belong to. */
  private async assertRecord(
    tenantId: string,
    userId: string,
    entityType: CustomFieldEntity,
    entityId: string,
    code: 'people.read' | 'people.write',
  ): Promise<void> {
    const entityIds = await runInTenant(tenantId, async () => {
      if (entityType === 'ENGAGEMENT') {
        const e = await this.prisma.db.engagement.findUnique({
          where: { id: entityId },
          select: { entityId: true },
        });
        return e ? [e.entityId] : [];
      }
      const list = await this.prisma.db.engagement.findMany({
        where: { personId: entityId },
        select: { entityId: true },
      });
      return list.map((e) => e.entityId);
    });
    if (entityIds.length === 0) throw new NotFoundException();
    for (const id of entityIds)
      if (await this.access.can(tenantId, userId, code, id)) return;
    throw new NotFoundException(); // do not reveal records the caller cannot see
  }

  async values(
    tenantId: string,
    userId: string,
    entityType: CustomFieldEntity,
    entityId: string,
  ): Promise<CustomFieldValuesView> {
    await this.assertRecord(
      tenantId,
      userId,
      entityType,
      entityId,
      'people.read',
    );
    const roles = await this.roleKeys(tenantId, userId);
    const defs = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.findMany({
        where: { entityType, archived: false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    const vals = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldValue.findMany({ where: { entityId } }),
    );
    const byDef = new Map(vals.map((v) => [v.definitionId, v.value]));
    return defs
      .filter((d) => this.canSee(d, roles))
      .map((d) => ({
        field: this.view(d, this.canChange(d, roles)),
        value: (byDef.get(d.id) ?? null) as string | number | null,
      }));
  }

  private async check(
    tenantId: string,
    d: Def,
    raw: string | number,
  ): Promise<string | number> {
    switch (d.type) {
      case 'TEXT':
        if (typeof raw !== 'string')
          throw new BadRequestException(`${d.label} must be text`);
        return raw.trim();
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n))
          throw new BadRequestException(`${d.label} must be a number`);
        return n;
      }
      case 'DATE': {
        const s = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
          throw new BadRequestException(`${d.label} must be a date`);
        return s;
      }
      case 'SELECT':
        if (!(asList(d.options) ?? []).includes(String(raw)))
          throw new BadRequestException(
            `${d.label}: choose one of the listed options`,
          );
        return String(raw);
      case 'FILE':
        // Throws NotFound for a file that is not this company's.
        await this.files.get(tenantId, String(raw)).catch(() => {
          throw new BadRequestException(`${d.label}: that file does not exist`);
        });
        return String(raw);
    }
  }

  /** Saves the given keys. A null (or empty) value clears a field, unless it is required. */
  async saveValues(
    tenantId: string,
    userId: string,
    entityType: CustomFieldEntity,
    entityId: string,
    input: Record<string, string | number | null>,
  ): Promise<CustomFieldValuesView> {
    await this.assertRecord(
      tenantId,
      userId,
      entityType,
      entityId,
      'people.write',
    );
    const roles = await this.roleKeys(tenantId, userId);
    const defs = await runInTenant(tenantId, async () =>
      this.prisma.db.customFieldDefinition.findMany({
        where: { entityType, archived: false },
      }),
    );
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const writes: { d: Def; value: string | number | null }[] = [];
    for (const [key, raw] of Object.entries(input)) {
      const d = byKey.get(key);
      if (!d) throw new BadRequestException(`There is no field “${key}”`);
      if (!this.canChange(d, roles))
        throw new ForbiddenException(`You may not change ${d.label}`);
      const empty = raw === null || raw === '';
      if (empty && d.required)
        throw new BadRequestException(`${d.label} is required`);
      writes.push({
        d,
        value: empty ? null : await this.check(tenantId, d, raw),
      });
    }
    await runInTenant(tenantId, async () => {
      for (const w of writes) {
        if (w.value === null)
          await this.prisma.db.customFieldValue.deleteMany({
            where: { definitionId: w.d.id, entityId },
          });
        else
          await this.prisma.db.customFieldValue.upsert({
            where: {
              definitionId_entityId: { definitionId: w.d.id, entityId },
            },
            update: { value: w.value, updatedBy: userId },
            create: {
              tenantId,
              definitionId: w.d.id,
              entityId,
              value: w.value,
              updatedBy: userId,
            },
          });
      }
    });
    return this.values(tenantId, userId, entityType, entityId);
  }
}
