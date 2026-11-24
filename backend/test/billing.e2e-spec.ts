import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { LimitsService } from '../src/modules/billing/limits.service.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { TokenService } from '../src/modules/identity/token.service.js';
import { PRESET_ROLES } from '../src/modules/platform-admin/platform-permissions.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tenantId = '';
let adminToken = '';
let staffToken = '';
let supportToken = '';
let planId = '';

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token: string,
) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function staff(name: string, roleKey: string) {
  const user = await runAsSystem(async () =>
    prisma.db.platformUser.create({
      data: {
        email: `${name}@billing.test`,
        status: 'ACTIVE',
        roleId: PRESET_ROLES.find((r) => r.key === roleKey)!.id,
      },
    }),
  );
  const sessionId = crypto.randomUUID();
  const token = await app
    .get(TokenService)
    .signPlatformAccess({ platformUserId: user.id, sessionId });
  await redis.client.set(`stepup:${sessionId}`, '1', 'EX', 600);
  return token;
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  await redis.client.flushdb();
  await runAsSystem(async () => {
    await prisma.db.platformUser.deleteMany({
      where: { email: { endsWith: '@billing.test' } },
    });
    await prisma.db.plan.deleteMany({ where: { key: 'e2e-tiny' } });
  });
  await deleteTenantData(prisma, 'bill-a');
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug: 'bill-a', name: 'BILL A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const user = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email: 'admin@bill-a.test',
        passwordHash: await app
          .get(PasswordService)
          .hash('correct horse battery'),
        status: 'ACTIVE',
      },
    }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'tenant_admin' } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: user.id, roleId: role!.id },
    });
  });
  adminToken = (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
  staffToken = await staff('boss', 'super_admin');
  supportToken = await staff('helper', 'support');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'bill-a');
  await runAsSystem(async () => {
    await prisma.db.plan.deleteMany({ where: { key: 'e2e-tiny' } });
    await prisma.db.platformUser.deleteMany({
      where: { email: { endsWith: '@billing.test' } },
    });
  });
  await app.close();
});

describe('plans and limits (D-20)', () => {
  it('lists the seeded plans, with exactly one default', async () => {
    const r = await call('get', '/platform/plans', staffToken).expect(200);
    const keys = (r.body as { key: string }[]).map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['free', 'starter', 'business', 'internal']),
    );
    expect(
      (r.body as { isDefault: boolean }[]).filter((p) => p.isDefault),
    ).toHaveLength(1);
  });

  it('lets billing staff create a plan and refuses support staff', async () => {
    const body = {
      key: 'e2e-tiny',
      name: 'Tiny',
      priceMonthly: 100,
      priceYearly: 1000,
      isPublic: false,
      limits: { users: 1, storage_mb: 1, signatures_month: 0 },
    };
    await call('post', '/platform/plans', supportToken).send(body).expect(403);
    const r = await call('post', '/platform/plans', staffToken)
      .send(body)
      .expect(201);
    planId = (r.body as { id: string }).id;
    expect((r.body as { limits: unknown }).limits).toEqual(body.limits);
  });

  it('puts a company on a plan and shows the plan with live usage', async () => {
    await call('put', `/platform/tenants/${tenantId}/subscription`, staffToken)
      .send({ planId })
      .expect(200);
    const r = await call('get', '/billing/plan', adminToken).expect(200);
    const v = r.body as {
      plan: { key: string };
      limits: { users: number };
      usage: { users: number };
    };
    expect(v.plan.key).toBe('e2e-tiny');
    expect(v.limits.users).toBe(1);
    expect(v.usage.users).toBe(1);
  });

  it('refuses a signature request over the limit with a 402 the web app can read', async () => {
    const r = await call(
      'put',
      `/platform/tenants/${tenantId}/subscription`,
      staffToken,
    )
      .send({ planId })
      .expect(200);
    expect(
      (r.body as { limits: { signatures_month: number } }).limits
        .signatures_month,
    ).toBe(0);
    await app
      .get(LimitsService)
      .assert(tenantId, 'signatures_month')
      .then(
        () => {
          throw new Error('should have been refused');
        },
        (e: { status: number; response: { code: string; metric: string } }) => {
          expect(e.status).toBe(402);
          expect(e.response.code).toBe('PLAN_LIMIT');
          expect(e.response.metric).toBe('signatures_month');
        },
      );
  });

  it('applies a per-company override on top of the plan and lets unlimited through', async () => {
    const r = await call(
      'put',
      `/platform/tenants/${tenantId}/subscription`,
      staffToken,
    )
      .send({ planId, limitOverrides: { signatures_month: null, users: 5 } })
      .expect(200);
    const v = r.body as {
      limits: { users: number; signatures_month: number | null };
      overridden: string[];
    };
    expect(v.limits.users).toBe(5);
    expect(v.limits.signatures_month).toBeNull();
    expect(v.overridden.sort()).toEqual(['signatures_month', 'users']);
    await app.get(LimitsService).assert(tenantId, 'signatures_month');
  });

  it('will not remove a plan that companies are on, nor the default plan', async () => {
    await call('delete', `/platform/plans/${planId}`, staffToken).expect(400);
    const list = (await call('get', '/platform/plans', staffToken)).body as {
      id: string;
      isDefault: boolean;
    }[];
    const def = list.find((p) => p.isDefault)!;
    await call('delete', `/platform/plans/${def.id}`, staffToken).expect(400);
  });
});
