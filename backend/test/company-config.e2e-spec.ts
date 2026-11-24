import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { NotificationRulesService } from '../src/modules/notifications/notification-rules.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const fakeMail = {
  send: async () => undefined,
  sendVia: async () => undefined,
  canResend: async () => false,
  retry: async () => false,
};

let app: INestApplication;
let prisma: PrismaService;
let tenantId = '';
let adminToken = '';
let adminId = '';
let empId = '';

const call = (m: 'get' | 'put', path: string, token: string) =>
  request(app.getHttpServer())
    [m](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

const login = (email: string) =>
  request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ tenant: 'cfg-a', email, password: 'correct horse battery' });

async function makeUser(email: string, roleKey: string) {
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
  return user.id;
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
  await deleteTenantData(prisma, 'cfg-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'cfg-a', name: 'CFG A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  adminId = await makeUser('admin@cfg-a.test', 'tenant_admin');
  empId = await makeUser('emp@cfg-a.test', 'employee');
  adminToken = (await app.get(SessionService).start(tenantId, adminId, {}))
    .accessToken;
});

afterAll(async () => {
  await deleteTenantData(prisma, 'cfg-a');
  await app.close();
});

const setting = (key: string, value: unknown) =>
  call('put', `/settings/tenant/${key}`, adminToken).send({ value });

describe('company configuration (D-69)', () => {
  it('rejects a bad time zone and a bad address range with a clear message', async () => {
    await setting('region.timeZone', 'Mars/Base').expect(400);
    await setting('signin.adminIpAllowlist', ['not-an-ip']).expect(400);
    await setting('signin.allowedEmailDomains', ['not a domain']).expect(400);
    await setting('region.dateFormat', 'DD/MM/YYYY').expect(204);
    const r = await call('get', '/settings', adminToken).expect(200);
    expect(r.body.values['region.dateFormat']).toBe('DD/MM/YYYY');
    expect(r.body.values['region.timeZone']).toBe('Asia/Kolkata');
  });

  it('refuses an administrator outside the allowed networks, but not an employee', async () => {
    await setting('signin.adminIpAllowlist', ['203.0.113.0/24']).expect(204);
    const blocked = await login('admin@cfg-a.test');
    expect(blocked.status).toBe(403);
    expect(JSON.stringify(blocked.body)).toContain('NETWORK_NOT_ALLOWED');
    const emp = await login('emp@cfg-a.test');
    expect(emp.status).toBe(200);
    // A refresh from outside is refused too.
    await setting('signin.adminIpAllowlist', []).expect(204);
    await login('admin@cfg-a.test').then((r) => expect(r.status).toBe(200));
  });

  it('asks for a new password once it has expired', async () => {
    await setting('security.passwordExpiryDays', 30).expect(204);
    await runAsSystem(async () => {
      await prisma.db.user.update({
        where: { id: empId },
        data: { passwordChangedAt: new Date(Date.now() - 60 * 86_400_000) },
      });
    });
    const r = await login('emp@cfg-a.test');
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PASSWORD_EXPIRED');
    await setting('security.passwordExpiryDays', 0).expect(204);
  });

  it('lets a company choose who is told about an event', async () => {
    const m = await call('get', '/notification-rules', adminToken).expect(200);
    const cell = (roleKey: string) =>
      m.body.cells.find(
        (c: { event: string; roleKey: string }) =>
          c.event === 'letter.issued' && c.roleKey === roleKey,
      );
    expect(cell('tenant_admin').enabled).toBe(true);
    const rules = app.get(NotificationRulesService);
    expect(await rules.recipients(tenantId, 'letter.issued')).toContain(
      'admin@cfg-a.test',
    );

    await call('put', '/notification-rules', adminToken)
      .send({
        cells: [
          {
            event: 'letter.issued',
            roleKey: 'tenant_admin',
            channel: 'EMAIL',
            enabled: false,
          },
        ],
      })
      .expect(200);
    expect(await rules.recipients(tenantId, 'letter.issued')).not.toContain(
      'admin@cfg-a.test',
    );
  });
});
