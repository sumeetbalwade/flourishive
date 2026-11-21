import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPrismaClient,
  type PrismaService,
  type ScopedPrismaClient,
} from './prisma.service.js';
import { deleteTenantData } from '../../../test/helpers.js';
import { runAsSystem, runInTenant } from './tenant-context.js';
import { TENANT_SCOPED_MODELS } from './tenant-scoping.js';

/**
 * Cross-tenant safety net (plan: Phase 1 quality). For every tenant-scoped
 * model, tenant B must not be able to read, change or delete tenant A's rows.
 * New models are added to `fixtures` below; the schema test fails until they are.
 */
let db: ScopedPrismaClient;
let a: string;
let b: string;

type Delegate = {
  findMany(args?: object): Promise<unknown[]>;
  findFirst(args?: object): Promise<unknown>;
  findUnique(args: object): Promise<unknown>;
  count(args?: object): Promise<number>;
  updateMany(args: object): Promise<{ count: number }>;
  deleteMany(args: object): Promise<{ count: number }>;
  update(args: object): Promise<unknown>;
  delete(args: object): Promise<unknown>;
  create(args: object): Promise<Record<string, unknown>>;
};

type Fixture = {
  delegate: string;
  /** Filter and unique-lookup for a created row; defaults to its id. */
  where?: (row: Record<string, unknown>) => object;
  unique?: (row: Record<string, unknown>) => object;
  create: (tenantId: string) => Promise<object>;
  change: object;
};

// Parent rows are created with system scope: they are test plumbing, not the
// operation under test.
const newUser = (tenantId: string) =>
  runAsSystem(
    async () =>
      await db.user.create({
        data: { tenantId, email: `${crypto.randomUUID()}@xt.test` },
      }),
  );
const newRole = (tenantId: string) =>
  runAsSystem(
    async () =>
      await db.role.create({
        data: {
          tenantId,
          key: crypto.randomUUID().slice(0, 8),
          name: 'Parent role',
        },
      }),
  );
const newEntity = (tenantId: string) =>
  runAsSystem(
    async () =>
      await db.entity.create({
        data: {
          tenantId,
          name: crypto.randomUUID().slice(0, 8),
          legalName: 'Parent Ltd',
        },
      }),
  );
const newPerson = (tenantId: string) =>
  runAsSystem(
    async () =>
      await db.person.create({
        data: { tenantId, firstName: 'Pat', lastName: 'Parent' },
      }),
  );
const newEngagement = async (tenantId: string) =>
  runAsSystem(
    async () =>
      await db.engagement.create({
        data: {
          tenantId,
          personId: (await newPerson(tenantId)).id,
          entityId: (await newEntity(tenantId)).id,
          type: 'EMPLOYEE',
          employeeCode: crypto.randomUUID().slice(0, 12),
          startDate: new Date('2026-01-01'),
        },
      }),
  );
const newSession = async (tenantId: string) =>
  runAsSystem(
    async () =>
      await db.session.create({
        data: {
          tenantId,
          userId: (await newUser(tenantId)).id,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      }),
  );

const fixtures: Record<string, Fixture> = {
  Entity: {
    delegate: 'entity',
    create: async (tenantId) => ({
      data: { tenantId, name: 'HQ', legalName: 'HQ Pvt Ltd' },
    }),
    change: { name: 'hacked' },
  },
  JobRecord: {
    delegate: 'jobRecord',
    create: async (tenantId) => ({
      data: { tenantId, name: 'test.job', payload: { x: 1 } },
    }),
    change: { attempts: 99 },
  },
  User: {
    delegate: 'user',
    create: async (tenantId) => ({
      data: { tenantId, email: `${crypto.randomUUID()}@xt.test` },
    }),
    change: { mfaRequired: true },
  },
  RecoveryCode: {
    delegate: 'recoveryCode',
    create: async (tenantId) => ({
      data: {
        tenantId,
        userId: (await newUser(tenantId)).id,
        codeHash: 'a'.repeat(64),
      },
    }),
    change: { usedAt: new Date() },
  },
  Session: {
    delegate: 'session',
    create: async (tenantId) => ({
      data: {
        tenantId,
        userId: (await newUser(tenantId)).id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    }),
    change: { userAgent: 'hacked' },
  },
  Role: {
    delegate: 'role',
    create: async (tenantId) => ({
      data: {
        tenantId,
        key: crypto.randomUUID().slice(0, 8),
        name: 'Test role',
      },
    }),
    change: { name: 'hacked' },
  },
  RolePermission: {
    delegate: 'rolePermission',
    where: (r) => ({ roleId: r.roleId, permissionCode: r.permissionCode }),
    unique: (r) => ({
      roleId_permissionCode: {
        roleId: r.roleId,
        permissionCode: r.permissionCode,
      },
    }),
    create: async (tenantId) => ({
      data: {
        tenantId,
        roleId: (await newRole(tenantId)).id,
        permissionCode: 'self.read',
      },
    }),
    change: { permissionCode: 'people.read' },
  },
  UserRole: {
    delegate: 'userRole',
    create: async (tenantId) => ({
      data: {
        tenantId,
        userId: (await newUser(tenantId)).id,
        roleId: (await newRole(tenantId)).id,
      },
    }),
    change: { entityId: null },
  },
  SettingValue: {
    delegate: 'settingValue',
    create: async (tenantId) => ({
      data: {
        tenantId,
        scope: 'TENANT',
        scopeId: tenantId,
        key: 'branding.accentColor',
        value: '#112233',
      },
    }),
    change: { value: '#ffffff' },
  },
  Location: {
    delegate: 'location',
    create: async (tenantId) => ({
      data: { tenantId, name: crypto.randomUUID().slice(0, 8) },
    }),
    change: { city: 'Hacked' },
  },
  Department: {
    delegate: 'department',
    create: async (tenantId) => ({
      data: { tenantId, name: crypto.randomUUID().slice(0, 8) },
    }),
    change: { name: 'hacked' },
  },
  Designation: {
    delegate: 'designation',
    create: async (tenantId) => ({
      data: { tenantId, name: crypto.randomUUID().slice(0, 8) },
    }),
    change: { name: 'hacked' },
  },
  Person: {
    delegate: 'person',
    create: async (tenantId) => ({
      data: { tenantId, firstName: 'Ada', lastName: 'Lovelace' },
    }),
    change: { firstName: 'hacked' },
  },
  Engagement: {
    delegate: 'engagement',
    create: async (tenantId) => ({
      data: {
        tenantId,
        personId: (await newPerson(tenantId)).id,
        entityId: (await newEntity(tenantId)).id,
        type: 'EMPLOYEE',
        employeeCode: crypto.randomUUID().slice(0, 12),
        startDate: new Date('2026-01-01'),
      },
    }),
    change: { status: 'ENDED' },
  },
  InternDetail: {
    delegate: 'internDetail',
    create: async (tenantId) => ({
      data: {
        tenantId,
        engagementId: (await newEngagement(tenantId)).id,
        college: 'Test College',
      },
    }),
    change: { college: 'hacked' },
  },
  AuditLog: {
    delegate: 'auditLog',
    where: (r) => ({ seq: r.seq }),
    unique: (r) => ({ seq: r.seq }),
    create: async (tenantId) => ({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        action: 'test.event',
        createdAt: new Date(),
        prevHash: '0'.repeat(64),
        hash: 'f'.repeat(64),
      },
    }),
    change: { action: 'hacked' },
  },
  AuditChainHead: {
    delegate: 'auditChainHead',
    where: (r) => ({ tenantId: r.tenantId }),
    unique: (r) => ({ tenantId: r.tenantId }),
    create: async (tenantId) => ({
      data: { tenantId, lastHash: '0'.repeat(64) },
    }),
    change: { lastHash: 'f'.repeat(64) },
  },
  File: {
    delegate: 'file',
    create: async (tenantId) => ({
      data: {
        tenantId,
        storageKey: `${tenantId}/${crypto.randomUUID()}`,
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5,
        sha256: 'a'.repeat(64),
      },
    }),
    change: { originalName: 'hacked.pdf' },
  },
  Letterhead: {
    delegate: 'letterhead',
    create: async (tenantId) => ({
      data: {
        tenantId,
        entityId: (await newEntity(tenantId)).id,
        version: 1,
        name: 'Letterhead',
        fileId: crypto.randomUUID(),
      },
    }),
    change: { name: 'hacked' },
  },
  NumberingScheme: {
    delegate: 'numberingScheme',
    create: async (tenantId) => ({
      data: {
        tenantId,
        entityId: (await newEntity(tenantId)).id,
        letterType: 'OFFER',
        format: 'X/{SEQ:4}',
      },
    }),
    change: { format: 'hacked' },
  },
  NumberingCounter: {
    delegate: 'numberingCounter',
    create: async (tenantId) => {
      const scheme = await runAsSystem(
        async () =>
          await db.numberingScheme.create({
            data: {
              tenantId,
              entityId: (await newEntity(tenantId)).id,
              letterType: 'OFFER',
              format: 'X/{SEQ:4}',
            },
          }),
      );
      return {
        data: { tenantId, schemeId: scheme.id, period: '2026', lastSeq: 1 },
      };
    },
    change: { lastSeq: 99 },
  },
  Template: {
    delegate: 'template',
    create: async (tenantId) => ({
      data: { tenantId, name: crypto.randomUUID(), letterType: 'OFFER' },
    }),
    change: { name: 'hacked' },
  },
  TemplateVersion: {
    delegate: 'templateVersion',
    create: async (tenantId) => {
      const template = await runAsSystem(
        async () =>
          await db.template.create({
            data: { tenantId, name: crypto.randomUUID(), letterType: 'OFFER' },
          }),
      );
      return {
        data: {
          tenantId,
          templateId: template.id,
          version: 1,
          content: {},
          fields: [],
        },
      };
    },
    change: { layoutKey: 'hacked' },
  },
  GeneratedDocument: {
    delegate: 'generatedDocument',
    create: async (tenantId) => {
      const entity = await newEntity(tenantId);
      const template = await runAsSystem(
        async () =>
          await db.template.create({
            data: { tenantId, name: crypto.randomUUID(), letterType: 'OFFER' },
          }),
      );
      const tv = await runAsSystem(
        async () =>
          await db.templateVersion.create({
            data: {
              tenantId,
              templateId: template.id,
              version: 1,
              content: {},
              fields: [],
            },
          }),
      );
      const lh = await runAsSystem(
        async () =>
          await db.letterhead.create({
            data: {
              tenantId,
              entityId: entity.id,
              version: 1,
              name: 'L',
              fileId: crypto.randomUUID(),
            },
          }),
      );
      return {
        data: {
          tenantId,
          entityId: entity.id,
          templateVersionId: tv.id,
          letterheadId: lh.id,
          letterType: 'OFFER',
          reference: crypto.randomUUID(),
          verifyToken: crypto.randomUUID(),
          data: {},
          fileId: crypto.randomUUID(),
          sha256: 'a'.repeat(64),
          pageCount: 1,
        },
      };
    },
    change: { letterType: 'hacked' },
  },
  Notification: {
    delegate: 'notification',
    create: async (tenantId) => ({
      data: {
        tenantId,
        event: 'test',
        toEmail: 'a@b.test',
        subject: 's',
        body: 'b',
      },
    }),
    change: { subject: 'hacked' },
  },
  RefreshToken: {
    delegate: 'refreshToken',
    create: async (tenantId) => ({
      data: {
        tenantId,
        sessionId: (await newSession(tenantId)).id,
        tokenHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    }),
    change: { usedAt: new Date() },
  },
};

const delegate = (model: string) =>
  (db as unknown as Record<string, Delegate>)[fixtures[model]!.delegate]!;

const wipe = () =>
  Promise.all(
    ['xt-a', 'xt-b'].map((slug) =>
      deleteTenantData({ db } as PrismaService, slug),
    ),
  );

beforeAll(async () => {
  db = createPrismaClient(process.env.DATABASE_URL!);
  await wipe();
  await runAsSystem(async () => {
    for (const code of ['self.read', 'people.read'])
      await db.permission.upsert({
        where: { code },
        update: {},
        create: { code, description: code },
      });
    a = (await db.tenant.create({ data: { slug: 'xt-a', name: 'Tenant A' } }))
      .id;
    b = (await db.tenant.create({ data: { slug: 'xt-b', name: 'Tenant B' } }))
      .id;
  });
});

afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe('schema guard', () => {
  it('lists every model that has a tenantId column', () => {
    const dir = join(process.cwd(), 'prisma/schema');
    const found = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.prisma'))) {
      for (const m of readFileSync(join(dir, file), 'utf8').matchAll(
        /model (\w+) \{([^}]*)\}/g,
      )) {
        if (/^\s*tenantId\s/m.test(m[2]!)) found.add(m[1]!);
      }
    }
    expect([...found].sort()).toEqual([...TENANT_SCOPED_MODELS].sort());
    expect(Object.keys(fixtures).sort()).toEqual(
      [...TENANT_SCOPED_MODELS].sort(),
    );
  });
});

describe('queries without a scope', () => {
  it('fail closed', async () => {
    await expect(db.entity.findMany()).rejects.toThrow('No tenant scope');
    await expect(db.tenant.findMany()).rejects.toThrow('No tenant scope');
  });
});

describe.each([...TENANT_SCOPED_MODELS])('tenant isolation on %s', (model) => {
  let filter: object;
  let unique: object;

  beforeAll(async () => {
    const row = await runInTenant(
      a,
      async () =>
        await delegate(model).create(await fixtures[model]!.create(a)),
    );
    filter = fixtures[model]!.where?.(row) ?? { id: row.id };
    unique = fixtures[model]!.unique?.(row) ?? { id: row.id };
  });

  it('tenant A sees its own row', async () => {
    const rows = await runInTenant(
      a,
      async () => await delegate(model).findMany(),
    );
    expect(rows).toHaveLength(1);
  });

  it('tenant B cannot list, count or look up the row', async () => {
    await runInTenant(b, async () => {
      expect(await delegate(model).findMany()).toHaveLength(0);
      expect(await delegate(model).count()).toBe(0);
      expect(await delegate(model).findFirst({ where: filter })).toBeNull();
      expect(await delegate(model).findUnique({ where: unique })).toBeNull();
    });
  });

  it('tenant B cannot update or delete the row', async () => {
    await runInTenant(b, async () => {
      expect(
        (
          await delegate(model).updateMany({
            where: filter,
            data: fixtures[model]!.change,
          })
        ).count,
      ).toBe(0);
      expect((await delegate(model).deleteMany({ where: filter })).count).toBe(
        0,
      );
      await expect(
        delegate(model).update({
          where: unique,
          data: fixtures[model]!.change,
        }),
      ).rejects.toThrow();
      await expect(delegate(model).delete({ where: unique })).rejects.toThrow();
    });
    expect(
      await runInTenant(a, async () => await delegate(model).count()),
    ).toBe(1);
  });

  it('tenant B cannot write a row into tenant A', async () => {
    await expect(
      runInTenant(
        b,
        async () =>
          await delegate(model).create(await fixtures[model]!.create(a)),
      ),
    ).rejects.toThrow('Cross-tenant write refused');
  });
});

describe('tenants table', () => {
  it('a tenant only sees itself', async () => {
    const rows = await runInTenant(a, async () => await db.tenant.findMany());
    expect(rows.map((t) => t.slug)).toEqual(['xt-a']);
  });
});
