import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPrismaClient,
  type ScopedPrismaClient,
} from './prisma.service.js';
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
  create(args: object): Promise<{ id: string }>;
};

const fixtures: Record<
  string,
  { delegate: string; create: (tenantId: string) => object; change: object }
> = {
  Entity: {
    delegate: 'entity',
    create: (tenantId) => ({
      data: { tenantId, name: 'HQ', legalName: 'HQ Pvt Ltd' },
    }),
    change: { name: 'hacked' },
  },
  JobRecord: {
    delegate: 'jobRecord',
    create: (tenantId) => ({
      data: { tenantId, name: 'test.job', payload: { x: 1 } },
    }),
    change: { attempts: 99 },
  },
};

const delegate = (model: string) =>
  (db as unknown as Record<string, Delegate>)[fixtures[model]!.delegate]!;

beforeAll(async () => {
  db = createPrismaClient(process.env.DATABASE_URL!);
  await runAsSystem(async () => {
    await db.jobRecord.deleteMany();
    await db.entity.deleteMany();
    await db.tenant.deleteMany({ where: { slug: { in: ['xt-a', 'xt-b'] } } });
    a = (await db.tenant.create({ data: { slug: 'xt-a', name: 'Tenant A' } }))
      .id;
    b = (await db.tenant.create({ data: { slug: 'xt-b', name: 'Tenant B' } }))
      .id;
  });
});

afterAll(async () => {
  await runAsSystem(async () => {
    await db.jobRecord.deleteMany();
    await db.entity.deleteMany();
    await db.tenant.deleteMany({ where: { slug: { in: ['xt-a', 'xt-b'] } } });
  });
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
  let rowId: string;

  beforeAll(async () => {
    rowId = await runInTenant(
      a,
      async () => (await delegate(model).create(fixtures[model]!.create(a))).id,
    );
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
      expect(
        await delegate(model).findFirst({ where: { id: rowId } }),
      ).toBeNull();
      expect(
        await delegate(model).findUnique({ where: { id: rowId } }),
      ).toBeNull();
    });
  });

  it('tenant B cannot update or delete the row', async () => {
    await runInTenant(b, async () => {
      expect(
        (
          await delegate(model).updateMany({
            where: { id: rowId },
            data: fixtures[model]!.change,
          })
        ).count,
      ).toBe(0);
      expect(
        (await delegate(model).deleteMany({ where: { id: rowId } })).count,
      ).toBe(0);
      await expect(
        delegate(model).update({
          where: { id: rowId },
          data: fixtures[model]!.change,
        }),
      ).rejects.toThrow();
      await expect(
        delegate(model).delete({ where: { id: rowId } }),
      ).rejects.toThrow();
    });
    expect(
      await runInTenant(a, async () => await delegate(model).count()),
    ).toBe(1);
  });

  it('tenant B cannot write a row into tenant A', async () => {
    await expect(
      runInTenant(
        b,
        async () => await delegate(model).create(fixtures[model]!.create(a)),
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
