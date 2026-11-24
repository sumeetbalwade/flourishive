import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { TokenService } from '../src/modules/identity/token.service.js';
import { UsageService } from '../src/modules/controls/usage.service.js';
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
let tenantA = '';
let tenantB = '';
let adminA = '';
let staffToken = '';
let supportToken = '';

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token: string,
) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function tenant(slug: string) {
  await deleteTenantData(prisma, slug);
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug, name: slug.toUpperCase() } }),
  );
  await app.get(AccessService).provisionTenantRoles(t.id);
  return t.id;
}

async function admin(tenantId: string, email: string) {
  const user = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email,
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
  return (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
}

async function staff(name: string, roleKey: string) {
  const user = await runAsSystem(async () =>
    prisma.db.platformUser.create({
      data: {
        email: `${name}@controls.test`,
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
    await prisma.db.announcement.deleteMany();
    await prisma.db.platformUser.deleteMany({
      where: { email: { endsWith: '@controls.test' } },
    });
  });
  tenantA = await tenant('ctl-a');
  tenantB = await tenant('ctl-b');
  adminA = await admin(tenantA, 'admin@ctl-a.test');
  staffToken = await staff('boss', 'super_admin');
  supportToken = await staff('helper', 'support');
});

afterAll(async () => {
  await call('put', '/platform/maintenance', staffToken).send({
    enabled: false,
    message: '',
    until: null,
  });
  await runAsSystem(async () => {
    await prisma.db.announcement.deleteMany();
    await prisma.db.platformUser.deleteMany({
      where: { email: { endsWith: '@controls.test' } },
    });
  });
  await deleteTenantData(prisma, 'ctl-a');
  await deleteTenantData(prisma, 'ctl-b');
  await app.close();
});

describe('announcements (D-70)', () => {
  it('shows a banner to the chosen company only, and only while it is on', async () => {
    const now = Date.now();
    const when = (ms: number) => new Date(now + ms).toISOString();
    await call('post', '/platform/announcements', staffToken)
      .send({
        message: 'Only A',
        tone: 'WARNING',
        tenantIds: [tenantA],
        startsAt: when(-1000),
        endsAt: when(3_600_000),
      })
      .expect(201);
    await call('post', '/platform/announcements', staffToken)
      .send({
        message: 'Later',
        startsAt: when(3_600_000),
        endsAt: when(7_200_000),
      })
      .expect(201);
    const a = await call('get', '/announcements/active', adminA).expect(200);
    expect(a.body.map((x: { message: string }) => x.message)).toEqual([
      'Only A',
    ]);
    const b = await app.get(PasswordService); // keep tree-shaking honest
    void b;
    const adminB = await admin(tenantB, 'admin@ctl-b.test');
    expect(
      (await call('get', '/announcements/active', adminB).expect(200)).body,
    ).toEqual([]);
  });
  it('needs platform.controls', async () => {
    await call('post', '/platform/announcements', supportToken)
      .send({
        message: 'x',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 1000).toISOString(),
      })
      .expect(403);
  });
});

describe('feature switches (D-70)', () => {
  it('refuses a switched-off module and shows it in /auth/me', async () => {
    await call('put', `/platform/tenants/${tenantA}/features/org`, staffToken)
      .send({ enabled: false })
      .expect(200);
    await call('get', '/org/departments', adminA).expect(403);
    const me = await call('get', '/auth/me', adminA).expect(200);
    expect(me.body.disabledFeatures).toContain('org');
    await call('put', `/platform/tenants/${tenantA}/features/org`, staffToken)
      .send({ enabled: true })
      .expect(200);
    await call('get', '/org/departments', adminA).expect(200);
  });
  it('refuses DSC signing requests when DSC is off', async () => {
    await call(
      'put',
      `/platform/tenants/${tenantA}/features/signing.dsc`,
      staffToken,
    )
      .send({ enabled: false })
      .expect(200);
    const r = await call(
      'post',
      '/documents/00000000-0000-7000-8000-000000000000/signature-requests',
      adminA,
    ).send({ method: 'DSC' });
    expect(r.status).toBe(403);
    await call(
      'put',
      `/platform/tenants/${tenantA}/features/signing.dsc`,
      staffToken,
    )
      .send({ enabled: true })
      .expect(200);
  });
  it('is for people who manage companies', async () => {
    await call('put', `/platform/tenants/${tenantA}/features/org`, supportToken)
      .send({ enabled: false })
      .expect(403);
  });
});

describe('maintenance mode (D-70)', () => {
  it('stops company routes, keeps staff and health up, and ends cleanly', async () => {
    await call('put', '/platform/maintenance', staffToken)
      .send({ enabled: true, message: 'Back at 6pm', until: null })
      .expect(200);
    const r = await call('get', '/org/departments', adminA).expect(503);
    expect(r.body.maintenance).toBe(true);
    expect(r.body.message).toBe('Back at 6pm');
    await call('get', '/platform/tenants', staffToken).expect(200);
    await request(app.getHttpServer()).get('/v1/health').expect(200);
    const pub = await request(app.getHttpServer())
      .get('/v1/public/maintenance')
      .expect(200);
    expect(pub.body.enabled).toBe(true);
    await call('put', '/platform/maintenance', staffToken)
      .send({ enabled: false, message: '', until: null })
      .expect(200);
    await call('get', '/org/departments', adminA).expect(200);
  });
});

describe('usage overview (D-70)', () => {
  it('writes a nightly row per company and reports it', async () => {
    await app.get(UsageService).snapshotAll();
    const r = await call('get', '/platform/usage', staffToken).expect(200);
    const mine = r.body.tenants.find(
      (t: { slug: string }) => t.slug === 'ctl-a',
    );
    expect(mine.latest.users).toBeGreaterThanOrEqual(1);
    const d = await call(
      'get',
      `/platform/tenants/${tenantA}/usage`,
      staffToken,
    ).expect(200);
    expect(d.body.points.length).toBe(1);
  });
});

describe('setup export and import (D-70)', () => {
  it('previews, then copies settings, features and wording to another company, with no secrets', async () => {
    await call('put', '/settings/tenant/region.dateFormat', adminA)
      .send({ value: 'DD/MM/YYYY' })
      .expect(204);
    await call(
      'put',
      `/platform/tenants/${tenantA}/features/people.import`,
      staffToken,
    )
      .send({ enabled: false })
      .expect(200);
    const file = (
      await call(
        'get',
        `/platform/tenants/${tenantA}/export`,
        staffToken,
      ).expect(200)
    ).body;
    expect(JSON.stringify(file)).not.toMatch(/passw|secret|hash/i);
    expect(file.settings['region.dateFormat']).toBe('DD/MM/YYYY');

    const prev = await call(
      'post',
      `/platform/tenants/${tenantB}/import/preview`,
      staffToken,
    )
      .send({ file })
      .expect(200);
    expect(prev.body.dryRun).toBe(true);
    expect(
      prev.body.changes.some((c: { area: string }) => c.area === 'Settings'),
    ).toBe(true);
    // Nothing changed yet.
    expect(
      (
        await call('get', `/platform/tenants/${tenantB}/features`, staffToken)
      ).body.features.find((f: { key: string }) => f.key === 'people.import')
        .enabled,
    ).toBe(true);

    await call('post', `/platform/tenants/${tenantB}/import`, staffToken)
      .send({ file, dryRun: false })
      .expect(200);
    const feats = (
      await call('get', `/platform/tenants/${tenantB}/features`, staffToken)
    ).body.features;
    expect(
      feats.find((f: { key: string }) => f.key === 'people.import').enabled,
    ).toBe(false);
    const again = await call(
      'post',
      `/platform/tenants/${tenantB}/import/preview`,
      staffToken,
    )
      .send({ file })
      .expect(200);
    expect(again.body.changes).toEqual([]);
  });
});
