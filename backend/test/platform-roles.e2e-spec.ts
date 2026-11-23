import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { StepUpService } from '../src/modules/identity/step-up.service.js';
import { TokenService } from '../src/modules/identity/token.service.js';
import { PRESET_ROLES } from '../src/modules/platform-admin/platform-permissions.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const role = (key: string) => PRESET_ROLES.find((r) => r.key === key)!.id;

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tenantId = '';
const staff: Record<string, { id: string; token: string }> = {};

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  token: string,
) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function makeStaff(name: string, roleKey: string) {
  const user = await runAsSystem(
    async () =>
      await prisma.db.platformUser.create({
        data: {
          email: `${name}@roles.test`,
          status: 'ACTIVE',
          roleId: role(roleKey),
        },
      }),
  );
  const sessionId = crypto.randomUUID();
  const token = await app
    .get(TokenService)
    .signPlatformAccess({ platformUserId: user.id, sessionId });
  // Pretend the person just confirmed it is them, so sensitive calls go through.
  await redis.client.set(`stepup:${sessionId}`, '1', 'EX', 300);
  staff[name] = { id: user.id, token };
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
  void app.get(StepUpService);
  await redis.client.flushdb();
  await deleteTenantData(prisma, 'roles-a');
  await runAsSystem(async () => {
    await prisma.db.supportSession.deleteMany();
    await prisma.db.platformRefreshToken.deleteMany();
    await prisma.db.platformSession.deleteMany();
    await prisma.db.platformUser.deleteMany();
    await prisma.db.platformRole.deleteMany({ where: { isPreset: false } });
  });
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'roles-a', name: 'Roles A' },
        }),
    )
  ).id;
  await makeStaff('owner', 'owner');
  await makeStaff('boss', 'super_admin');
  await makeStaff('helper', 'support');
  await makeStaff('auditor', 'auditor');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'roles-a');
  await runAsSystem(async () => {
    await prisma.db.platformUser.deleteMany();
    await prisma.db.platformRole.deleteMany({ where: { isPreset: false } });
  });
  await app.close();
});

describe('platform staff roles (D-55)', () => {
  it('a Support user sees companies but not keys, staff or roles', async () => {
    const h = staff.helper!.token;
    await call('get', '/platform/tenants', h).expect(200);
    await call('get', '/platform/config', h).expect(403);
    await call('get', '/platform/users', h).expect(403);
    await call('get', '/platform/roles', h).expect(403);
    await call('put', '/platform/config/SMTP_HOST', h)
      .send({ value: 'x' })
      .expect(403);
  });

  it('an auditor can read but not open a company', async () => {
    const a = staff.auditor!.token;
    await call('get', '/platform/tenants', a).expect(200);
    await call('post', `/platform/tenants/${tenantId}/support-sessions`, a)
      .send({ reason: 'looking around', mode: 'READ', minutes: 30 })
      .expect(403);
  });

  it('a Super admin cannot change secrets or manage staff', async () => {
    const b = staff.boss!.token;
    await call('get', '/platform/config', b).expect(200);
    await call('put', '/platform/config/SMTP_PASS', b)
      .send({ value: 'a-new-password' })
      .expect(403);
    await call('get', '/platform/users', b).expect(403);
  });

  it('built-in roles cannot be edited; custom roles can be made, changed and removed', async () => {
    const o = staff.owner!.token;
    const preset = role('support');
    await call('patch', `/platform/roles/${preset}`, o)
      .send({ name: 'Renamed' })
      .expect(400);
    const created = await call('post', '/platform/roles', o)
      .send({ name: 'Log reader', permissions: ['logs.read'] })
      .expect(201);
    await call('patch', `/platform/roles/${created.body.id}`, o)
      .send({ permissions: ['logs.read', 'tenants.read'] })
      .expect(204);
    await call('post', '/platform/roles', o)
      .send({ name: 'Bad', permissions: ['not.a.permission'] })
      .expect(400);
    await call('delete', `/platform/roles/${created.body.id}`, o).expect(204);
  });

  it('nobody grants a power they lack, and only an Owner grants Owner', async () => {
    const b = staff.boss!.token;
    // The Super admin may manage staff? No: staff.manage is Owner-only, so use the Owner to test the subset rule.
    const o = staff.owner!.token;
    const made = await call('post', '/platform/roles', o)
      .send({
        name: 'Almost owner',
        permissions: ['staff.manage', 'roles.manage'],
      })
      .expect(201);
    // A staff member holding staff.manage but not config.secrets.manage cannot hand out the latter.
    await call('put', `/platform/users/${staff.helper!.id}/role`, o)
      .send({ roleId: made.body.id })
      .expect(204);
    await redis.client.del(`platform:perms:${staff.helper!.id}`);
    const sessionId = crypto.randomUUID();
    const token = await app
      .get(TokenService)
      .signPlatformAccess({ platformUserId: staff.helper!.id, sessionId });
    await redis.client.set(`stepup:${sessionId}`, '1', 'EX', 300);
    await call('post', '/platform/roles', token)
      .send({ name: 'Greedy', permissions: ['config.secrets.manage'] })
      .expect(403);
    await call('put', `/platform/users/${staff.auditor!.id}/role`, token)
      .send({ roleId: role('owner') })
      .expect(403);
    void b;
    // Put things back.
    await call('put', `/platform/users/${staff.helper!.id}/role`, o)
      .send({ roleId: role('support') })
      .expect(204);
    await call('delete', `/platform/roles/${made.body.id}`, o).expect(204);
  });

  it('the last active Owner cannot be demoted or suspended, and nobody removes their own right to manage roles', async () => {
    const o = staff.owner!;
    await call('put', `/platform/users/${o.id}/role`, o.token)
      .send({ roleId: role('super_admin') })
      .expect(400);
    await call('patch', `/platform/users/${o.id}`, o.token)
      .send({ status: 'DISABLED' })
      .expect(400);
  });
});

describe('support sessions (D-56)', () => {
  let sessionToken = '';
  let sessionId = '';

  it('needs a reason, and a view-only role cannot ask for change mode', async () => {
    const h = staff.helper!.token;
    await call('post', `/platform/tenants/${tenantId}/support-sessions`, h)
      .send({ reason: 'x', mode: 'READ', minutes: 30 })
      .expect(400);
    await call('post', `/platform/tenants/${tenantId}/support-sessions`, h)
      .send({ reason: 'Fixing a letter', mode: 'WRITE', minutes: 30 })
      .expect(403);
  });

  it('opens a view-only session that can read but not change, and is recorded', async () => {
    const res = await call(
      'post',
      `/platform/tenants/${tenantId}/support-sessions`,
      staff.helper!.token,
    )
      .send({ reason: 'Checking the letter hold', mode: 'READ', minutes: 60 })
      .expect(201);
    sessionToken = res.body.accessToken;
    sessionId = res.body.sessionId;
    expect(res.body.url).toContain('#/support?token=');

    const me = await call('get', '/auth/me', sessionToken).expect(200);
    expect(me.body.support).toMatchObject({ mode: 'READ' });
    await call('get', '/people', sessionToken).expect(200);
    await call('post', '/people', sessionToken)
      .send({ firstName: 'A', lastName: 'B' })
      .expect(403);

    const audit = await call('get', '/audit?pageSize=20', sessionToken).expect(
      200,
    );
    const actions = (
      audit.body.items as { actorType: string; action: string }[]
    ).map((i) => `${i.actorType}:${i.action}`);
    expect(actions).toContain('PLATFORM:support.session_started');
    expect(actions.some((a) => a.startsWith('SUPPORT:GET'))).toBe(true);
  });

  it('the company sees the session and can end it, after which the token stops working', async () => {
    const list = await call('get', '/support/sessions', sessionToken).expect(
      200,
    );
    expect(list.body[0]).toMatchObject({ id: sessionId, active: true });
    await call('post', '/support/sessions/current/end', sessionToken).expect(
      204,
    );
    await call('get', '/people', sessionToken).expect(401);
  });
});
