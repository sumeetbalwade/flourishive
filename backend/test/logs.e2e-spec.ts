import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { AlertsService } from '../src/modules/logs/alerts.service.js';
import { LogWriterService } from '../src/modules/logs/log-writer.service.js';
import { LogsService } from '../src/modules/logs/logs.service.js';
import { MailDeliveriesService } from '../src/modules/mail/mail-deliveries.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const sent: { to: string | string[]; subject: string; text: string }[] = [];
const fakeMail = {
  send: async (m: (typeof sent)[number]) => void sent.push(m),
  sendVia: async () => undefined,
  canResend: async () => false,
  retry: async () => false,
};

let app: INestApplication;
let prisma: PrismaService;
let tenantA = '';
let tenantB = '';
let adminA = '';
let adminAId = '';
let empA = '';
let adminB = '';

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token: string,
) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

const flush = () => app.get(LogWriterService).flush();

/** An error is kept just after the reply goes out, so wait for it briefly. */
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function tenant(slug: string) {
  await deleteTenantData(prisma, slug);
  const t = await runAsSystem(
    async () =>
      await prisma.db.tenant.create({
        data: { slug, name: slug.toUpperCase() },
      }),
  );
  await app.get(AccessService).provisionTenantRoles(t.id);
  return t.id;
}

async function userWithRole(tenantId: string, email: string, roleKey: string) {
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
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
      where: { tenantId_key: { tenantId, key: roleKey } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: user.id, roleId: role!.id },
    });
  });
  const token = (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
  return { token, id: user.id };
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(fakeMail)
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  tenantA = await tenant('log-a');
  tenantB = await tenant('log-b');
  const a = await userWithRole(tenantA, 'admin@log-a.test', 'tenant_admin');
  adminA = a.token;
  adminAId = a.id;
  empA = (await userWithRole(tenantA, 'emp@log-a.test', 'employee')).token;
  adminB = (await userWithRole(tenantB, 'admin@log-b.test', 'tenant_admin'))
    .token;
});

afterAll(async () => {
  await flush();
  await deleteTenantData(prisma, 'log-a');
  await deleteTenantData(prisma, 'log-b');
  await app.close();
});

describe('logs (D-67)', () => {
  it('is for people with logs.read only', async () => {
    await call('get', '/logs/requests', empA).expect(403);
    await call('get', '/logs/errors', empA).expect(403);
    await call('get', '/alerts', empA).expect(403);
  });

  it('keeps changes with the route template, never the raw id', async () => {
    const r = await call('put', '/mail/templates/auth.invite', adminA).send({
      subject: 'x',
      body: 'bad {{nope}}',
    });
    expect(r.status).toBe(400);
    await call('delete', '/mail/templates/auth.invite', adminA);
    await flush();
    const list = await call('get', '/logs/requests?method=PUT', adminA).expect(
      200,
    );
    const line = list.body.items.find(
      (i: { routePattern: string }) =>
        i.routePattern === '/v1/mail/templates/:event',
    );
    expect(line).toBeTruthy();
    expect(line.status).toBe(400);
    expect(JSON.stringify(list.body)).not.toContain('auth.invite');
  });

  it('shows a company only its own lines', async () => {
    await call('get', '/people/00000000-0000-0000-0000-000000000000', adminA);
    await flush();
    const b = await call('get', '/logs/requests', adminB).expect(200);
    expect(
      b.body.items.every((i: { tenantId: string }) => i.tenantId === tenantB),
    ).toBe(true);
    const mine = await call('get', '/logs/requests?status=4xx', adminA).expect(
      200,
    );
    expect(mine.body.total).toBeGreaterThan(0);
  });

  it('turns a failure into a story, finds it by request id, and keeps the stack from companies', async () => {
    const boom = Object.assign(
      new Error('getaddrinfo ENOTFOUND timestamp.digicert.com'),
      { code: 'ENOTFOUND' },
    );
    const spy = vi
      .spyOn(app.get(MailDeliveriesService), 'list')
      .mockRejectedValue(boom);
    const res = await call('get', '/mail/deliveries', adminA).expect(500);
    spy.mockRestore();
    const requestId = res.body.requestId as string;
    expect(requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(requestId);
    await flush();
    await until(
      async () =>
        (await call('get', `/logs/errors?requestId=${requestId}`, adminA)).body
          .total === 1,
    );

    const errors = await call(
      'get',
      `/logs/errors?requestId=${requestId}`,
      adminA,
    ).expect(200);
    expect(errors.body.total).toBe(1);
    const e = errors.body.items[0];
    expect(e.story).toContain('timestamp.digicert.com');
    expect(e.story).toContain('Integrations');
    expect(e.stack).toBeNull();
    expect(e.message).toBe('');

    const trace = await call('get', `/logs/trace/${requestId}`, adminA).expect(
      200,
    );
    const kinds = trace.body.entries.map((x: { kind: string }) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['request', 'error']));

    // Another company cannot find it by id.
    const other = await call('get', `/logs/trace/${requestId}`, adminB).expect(
      200,
    );
    expect(other.body.entries).toEqual([]);

    const copy = await call(
      'get',
      `/logs/trace/${requestId}/copy`,
      adminA,
    ).expect(200);
    expect(copy.body.text).toContain(`Reference: ${requestId}`);
    expect(copy.body.text).not.toMatch(/^\s+at /m);

    // A repeat joins the same group.
    const spy2 = vi
      .spyOn(app.get(MailDeliveriesService), 'list')
      .mockRejectedValue(boom);
    await call('get', '/mail/deliveries', adminA).expect(500);
    spy2.mockRestore();
    await until(
      async () =>
        ((await call('get', '/logs/errors', adminA)).body.items[0]?.count ??
          0) >= 2,
    );
    const grouped = await call('get', '/logs/errors', adminA).expect(200);
    expect(grouped.body.items[0].count).toBeGreaterThanOrEqual(2);
  });

  it('records sign-ins by outcome, without the address', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        tenant: 'log-a',
        email: 'admin@log-a.test',
        password: 'nope nope nope',
      })
      .expect(401);
    await flush();
    const r = await call(
      'get',
      '/logs/signins?outcome=BAD_PASSWORD',
      adminA,
    ).expect(200);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(r.body)).not.toContain('admin@log-a.test');
    const byAddress = await call(
      'get',
      '/logs/signins?q=admin@log-a.test',
      adminA,
    ).expect(200);
    expect(byAddress.body.total).toBeGreaterThanOrEqual(1);
  });

  it('deletes lines older than the retention', async () => {
    await runAsSystem(async () => {
      await prisma.db.logRequest.create({
        data: {
          requestId: 'old-request-1',
          tenantId: tenantA,
          method: 'GET',
          routePattern: '/v1/old',
          status: 200,
          durationMs: 5,
          createdAt: new Date(Date.now() - 90 * 86_400_000),
        },
      });
    });
    const n = await app.get(LogsService).purge();
    expect(n).toBeGreaterThanOrEqual(1);
    const left = await runAsSystem(
      async () =>
        await prisma.db.logRequest.count({
          where: { requestId: 'old-request-1' },
        }),
    );
    expect(left).toBe(0);
  });
});

describe('alerts (D-68)', () => {
  it('starts with everything off and keeps company-only events away from platform-only ones', async () => {
    const r = await call('get', '/alerts', adminA).expect(200);
    expect(
      r.body.items.every((i: { delivery: string }) => i.delivery === 'OFF'),
    ).toBe(true);
    const events = r.body.items.map((i: { event: string }) => i.event);
    expect(events).not.toContain('DISK_LOW');
    await call('put', '/alerts', adminA)
      .send({ items: [{ event: 'DISK_LOW', delivery: 'INSTANT' }] })
      .expect(400);
  });

  it('sends one email when mail is failing, not one per minute', async () => {
    await call('put', '/alerts', adminA)
      .send({ items: [{ event: 'MAIL_FAILING', delivery: 'INSTANT' }] })
      .expect(200);
    await runAsSystem(async () => {
      for (let i = 0; i < 6; i++)
        await prisma.db.mailDelivery.create({
          data: {
            tenantId: tenantA,
            event: 'auth.invite',
            toMasked: 'a***@x.test',
            toHash: 'f'.repeat(64),
            status: 'FAILED',
            error: 'The mail server refused the login',
          },
        });
    });
    sent.length = 0;
    const first = await app.get(AlertsService).tick();
    const second = await app.get(AlertsService).tick();
    expect(first.raised).toBeGreaterThanOrEqual(1);
    expect(second.raised).toBe(0);
    const mine = sent.filter((m) =>
      m.subject.includes('Email is not being delivered'),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toEqual(['admin@log-a.test']);
    // The other company's admin never subscribed, and never hears of it.
    expect(JSON.stringify(sent)).not.toContain('admin@log-b.test');
    void adminAId;
  });
});
