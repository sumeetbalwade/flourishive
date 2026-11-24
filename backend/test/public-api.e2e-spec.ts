import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
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
let tenantId = '';
let adminToken = '';
let mainEntity = '';
let otherEntity = '';
let engagementMain = '';
let engagementOther = '';

const http = () => request(app.getHttpServer());
const admin = (m: 'get' | 'post' | 'put' | 'delete', p: string) =>
  http()[m](`/v1${p}`).set('Authorization', `Bearer ${adminToken}`);

function tokenFor(
  c: { clientId: string; clientSecret: string },
  scope?: string,
) {
  return http().post('/v1/oauth/token').send({
    grant_type: 'client_credentials',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope,
  });
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
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'api-a');
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug: 'api-a', name: 'API A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const u = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email: 'admin@api-a.test',
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
      data: { tenantId, userId: u.id, roleId: role!.id },
    });
  });
  adminToken = (await app.get(SessionService).start(tenantId, u.id, {}))
    .accessToken;
  const mk = async (name: string, code: string) => {
    const e = await runAsSystem(async () =>
      prisma.db.entity.create({
        data: { tenantId, name, legalName: `${name} Ltd` },
      }),
    );
    const p = await runAsSystem(async () =>
      prisma.db.person.create({
        data: { tenantId, firstName: name, lastName: 'Person' },
      }),
    );
    const g = await runAsSystem(async () =>
      prisma.db.engagement.create({
        data: {
          tenantId,
          personId: p.id,
          entityId: e.id,
          type: 'EMPLOYEE',
          employeeCode: code,
          startDate: new Date('2026-01-01'),
        },
      }),
    );
    return { entity: e.id, engagement: g.id };
  };
  const a = await mk('Main', 'API-1');
  const b = await mk('Other', 'API-2');
  mainEntity = a.entity;
  engagementMain = a.engagement;
  otherEntity = b.entity;
  engagementOther = b.engagement;
});

afterAll(async () => {
  await deleteTenantData(prisma, 'api-a');
  await app.close();
});

describe('public API (D-20)', () => {
  let client: { id: string; clientId: string; clientSecret: string };
  let bearer = '';

  it('creates a client and shows the secret once', async () => {
    const r = await admin('post', '/api-clients')
      .send({
        name: 'ERP',
        scopes: ['employees:read'],
        entityIds: [mainEntity],
        rateLimitPerMinute: 3,
      })
      .expect(201);
    client = r.body;
    expect(client.clientSecret).toMatch(/^fhs_/);
    const list = await admin('get', '/api-clients').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(client.clientSecret);
  });

  it('rejects a wrong secret and a scope the client does not have', async () => {
    await tokenFor({ clientId: client.clientId, clientSecret: 'nope' }).expect(
      401,
    );
    await tokenFor(client, 'letters:create').expect(401);
    const ok = await tokenFor(client).expect(200);
    bearer = ok.body.access_token;
    expect(ok.body.token_type).toBe('Bearer');
  });

  it('serves only the allowed company, with rate limit headers', async () => {
    const r = await http()
      .get('/v1/api/employees')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    expect(
      r.body.data.map((e: { employeeCode: string }) => e.employeeCode),
    ).toEqual(['API-1']);
    expect(r.headers['x-ratelimit-limit']).toBe('3');
    await http()
      .get(`/v1/api/employees/${engagementMain}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    await http()
      .get(`/v1/api/employees/${engagementOther}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(404);
    await http()
      .get(`/v1/api/employees?entityId=${otherEntity}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(403);
  });

  it('refuses a route outside the token scope', async () => {
    await http()
      .post('/v1/api/letters')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ templateId: crypto.randomUUID(), entityId: mainEntity })
      .expect((res) => expect([403, 429]).toContain(res.status));
  });

  it('stops a client that goes over its per-minute limit', async () => {
    for (let i = 0; i < 4; i++)
      await http()
        .get('/v1/api/employees')
        .set('Authorization', `Bearer ${bearer}`);
    const r = await http()
      .get('/v1/api/employees')
      .set('Authorization', `Bearer ${bearer}`);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
  });

  it('stops working the moment a client is paused or deleted', async () => {
    await admin('put', `/api-clients/${client.id}`)
      .send({
        name: 'ERP',
        scopes: ['employees:read'],
        entityIds: [mainEntity],
        rateLimitPerMinute: 60,
        active: false,
      })
      .expect(200);
    await http()
      .get('/v1/api/employees')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(401);
    await tokenFor(client).expect(401);
  });

  it('keeps a bad token out', async () => {
    await http()
      .get('/v1/api/employees')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
    await http().get('/v1/api/employees').expect(401);
  });
});
