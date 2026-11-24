import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { WebhooksService } from '../src/modules/integrations/webhooks.service.js';
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
let token = '';
let server: Server;
let url = '';
let status = 200;
const received: { headers: Record<string, unknown>; body: string }[] = [];

const api = (m: 'get' | 'post' | 'put' | 'delete', p: string) =>
  request(app.getHttpServer())
    [m](`/v1${p}`)
    .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = status;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://localhost:${(server.address() as AddressInfo).port}/hook`;
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
  await deleteTenantData(prisma, 'wh-a');
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug: 'wh-a', name: 'WH A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const u = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email: 'admin@wh-a.test',
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
  token = (await app.get(SessionService).start(tenantId, u.id, {})).accessToken;
});

afterAll(async () => {
  await deleteTenantData(prisma, 'wh-a');
  await app.close();
  server.close();
});

describe('outbound webhooks (D-20)', () => {
  let id = '';
  let secret = '';

  it('refuses a plain http address that is not localhost, and shows the secret once', async () => {
    await api('post', '/webhooks')
      .send({ url: 'http://example.com/x', events: ['employee.created'] })
      .expect(400);
    const r = await api('post', '/webhooks')
      .send({ url, events: ['employee.created'] })
      .expect(201);
    id = r.body.id;
    secret = r.body.secret;
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await api('get', '/webhooks')).body)).not.toContain(
      secret,
    );
  });

  it('delivers a signed event the receiver can verify', async () => {
    received.length = 0;
    await app
      .get(WebhooksService)
      .emit(tenantId, 'employee.created', { id: 'e1' });
    await new Promise((r) => setTimeout(r, 500));
    expect(received).toHaveLength(1);
    const sig = String(received[0]!.headers['x-flourishive-signature']);
    const [t, v1] = sig.split(',').map((p) => p.split('=')[1]!);
    const expected = createHmac('sha256', secret)
      .update(`${t}.${received[0]!.body}`)
      .digest('hex');
    expect(v1).toBe(expected);
    expect(JSON.parse(received[0]!.body).type).toBe('employee.created');
    const log = (await api('get', `/webhooks/${id}/deliveries`)).body;
    expect(log[0].status).toBe('DELIVERED');
  });

  it('does not send events the subscription did not ask for', async () => {
    received.length = 0;
    await app
      .get(WebhooksService)
      .emit(tenantId, 'letter.created', { id: 'l1' });
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toHaveLength(0);
  });

  it('retries a failing endpoint with backoff and delivers when it recovers', async () => {
    status = 500;
    received.length = 0;
    await app
      .get(WebhooksService)
      .emit(tenantId, 'employee.created', { id: 'e2' });
    await new Promise((r) => setTimeout(r, 400));
    let log = (await api('get', `/webhooks/${id}/deliveries`)).body;
    const failing = log.find((d: { status: string }) => d.status === 'PENDING');
    expect(failing.attempts).toBe(1);
    expect(failing.nextAttemptAt).toBeTruthy();
    status = 200;
    await app.get(WebhooksService).tick(new Date(Date.now() + 2 * 60_000)); // past the one minute wait
    log = (await api('get', `/webhooks/${id}/deliveries`)).body;
    expect(
      log.filter((d: { status: string }) => d.status === 'DELIVERED'),
    ).toHaveLength(2);
  });

  it('gives up after the last retry and lets the company send it again', async () => {
    status = 500;
    await app
      .get(WebhooksService)
      .emit(tenantId, 'employee.created', { id: 'e3' });
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < 6; i++)
      await app
        .get(WebhooksService)
        .tick(new Date(Date.now() + 24 * 3_600_000));
    const log = (await api('get', `/webhooks/${id}/deliveries`)).body;
    const dead = log.find((d: { status: string }) => d.status === 'FAILED');
    expect(dead.attempts).toBe(6);
    status = 200;
    await api('post', `/webhooks/deliveries/${dead.id}/resend`).expect(204);
    const after = (await api('get', `/webhooks/${id}/deliveries`)).body;
    expect(after.find((d: { id: string }) => d.id === dead.id).status).toBe(
      'DELIVERED',
    );
  });

  it('blocks addresses that resolve to private networks', async () => {
    const r = await api('post', '/webhooks')
      .send({ url: 'https://127.0.0.1/hook', events: ['employee.created'] })
      .expect(201);
    await app
      .get(WebhooksService)
      .emit(tenantId, 'employee.created', { id: 'e4' });
    await new Promise((res) => setTimeout(res, 400));
    const log = (await api('get', `/webhooks/${r.body.id}/deliveries`)).body;
    expect(log[0].error).toMatch(/not reachable|public/i);
  });
});
