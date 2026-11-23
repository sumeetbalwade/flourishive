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

const sent: { to: string; subject: string; text: string; event?: string }[] =
  [];
const fakeMail = {
  send: async (m: (typeof sent)[number]) => void sent.push(m),
  sendVia: async (_s: unknown, m: (typeof sent)[number]) => void sent.push(m),
  canResend: async () => false,
  retry: async () => false,
};

let app: INestApplication;
let prisma: PrismaService;
let tenantId = '';
let adminToken = '';
let empToken = '';

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token: string,
) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function userWithRole(email: string, roleKey: string) {
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
  const s = await app.get(SessionService).start(tenantId, user.id, {});
  const claims = JSON.parse(
    Buffer.from(s.accessToken.split('.')[1]!, 'base64url').toString(),
  );
  await app
    .get(RedisService)
    .client.set(`stepup:${claims.sessionId}`, '1', 'EX', 300);
  return s.accessToken;
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
  await deleteTenantData(prisma, 'mail-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'mail-a', name: 'Mail A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  adminToken = await userWithRole('admin@mail-a.test', 'tenant_admin');
  empToken = await userWithRole('emp@mail-a.test', 'employee');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'mail-a');
  await app.close();
});

describe('company email sender (D-58, D-60)', () => {
  it('is for people with email.manage only', async () => {
    await call('get', '/mail/sender', empToken).expect(403);
    await call('get', '/mail/deliveries', empToken).expect(403);
  });

  it('refuses a mail server on a private network or a non-mail port', async () => {
    const own = (host: string, port: number) => ({
      kind: 'OWN_SMTP',
      fromName: 'Acme HR',
      fromAddress: 'hr@acme.test',
      smtp: { host, port, secure: false, user: 'u', pass: 'p' },
    });
    await call('put', '/mail/sender', adminToken)
      .send(own('169.254.169.254', 587))
      .expect(400);
    await call('put', '/mail/sender', adminToken)
      .send(own('127.0.0.1', 587))
      .expect(400);
    await call('put', '/mail/sender', adminToken)
      .send(own('8.8.8.8', 22))
      .expect(400);
  });

  it('cannot be activated before the code and a good test', async () => {
    await call('put', '/mail/sender', adminToken)
      .send({
        kind: 'VERIFIED_FROM',
        fromName: 'Acme HR',
        fromAddress: 'hr@acme.test',
      })
      .expect(200);
    await call('post', '/mail/sender/activate', adminToken).expect(409);
    await call('post', '/mail/sender/test', adminToken).expect(409);
  });

  it('verifies the address with an emailed code, tests, and activates', async () => {
    sent.length = 0;
    await call('post', '/mail/sender/verify/start', adminToken).expect(204);
    const mail = sent.find((m) => m.event === 'sender.verify')!;
    expect(mail.to).toBe('hr@acme.test');
    const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
    await call('post', '/mail/sender/verify/confirm', adminToken)
      .send({ code: '000000' })
      .expect(400);
    await call('post', '/mail/sender/verify/confirm', adminToken)
      .send({ code })
      .expect(200);
    const t = await call('post', '/mail/sender/test', adminToken).expect(200);
    expect(t.body.ok).toBe(true);
    const active = await call(
      'post',
      '/mail/sender/activate',
      adminToken,
    ).expect(200);
    expect(active.body.status).toBe('ACTIVE');
  });

  it('goes back to DRAFT when edited, and switches back to the default', async () => {
    const edited = await call('put', '/mail/sender', adminToken)
      .send({
        kind: 'VERIFIED_FROM',
        fromName: 'Acme People',
        fromAddress: 'hr@acme.test',
      })
      .expect(200);
    expect(edited.body.status).toBe('DRAFT');
    await call('delete', '/mail/sender', adminToken).expect(204);
    const state = await call('get', '/mail/sender', adminToken).expect(200);
    expect(state.body.sender).toBeNull();
  });
});
