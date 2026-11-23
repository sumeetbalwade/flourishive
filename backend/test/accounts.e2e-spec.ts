import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { MfaService } from '../src/modules/identity/mfa.service.js';
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
const users: Record<string, { id: string; token: string; sessionId: string }> =
  {};
const PASSWORD = 'correct horse battery';

const call = (method: 'get' | 'post' | 'delete', path: string, token: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function makeUser(name: string, roleKey: string, mfa = false) {
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const mfaSecret = mfa ? app.get(MfaService).newSecret() : null;
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: {
          tenantId,
          email: `${name}@acct.test`,
          passwordHash,
          status: 'ACTIVE',
          ...(mfaSecret
            ? {
                mfaSecretEnc: app.get(MfaService).encryptSecret(mfaSecret),
                mfaEnabledAt: new Date(),
              }
            : {}),
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
  await redis.client.set(`stepup:${claims.sessionId}`, '1', 'EX', 300);
  users[name] = {
    id: user.id,
    token: s.accessToken,
    sessionId: claims.sessionId,
  };
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
  await deleteTenantData(prisma, 'acct-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'acct-a', name: 'Acct A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  await makeUser('admin', 'tenant_admin');
  await makeUser('hr', 'hr_lead', true);
  await makeUser('hr2', 'hr_lead');
  await makeUser('emp', 'employee');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'acct-a');
  await app.close();
});

describe('account actions (D-63)', () => {
  it('a company admin resets a staff member’s two-step and it is audited', async () => {
    const res = await call(
      'post',
      `/users/${users.hr!.id}/actions/reset-mfa`,
      users.admin!.token,
    ).send({ reason: 'Lost the phone' });
    expect(res.status).toBe(200);
    const row = await runInTenant(tenantId, async () =>
      prisma.db.user.findUnique({ where: { id: users.hr!.id } }),
    );
    expect(row?.mfaEnabledAt).toBeNull();
    const audit = await call(
      'get',
      '/audit?pageSize=10',
      users.admin!.token,
    ).expect(200);
    expect(
      (audit.body.items as { action: string }[]).map((i) => i.action),
    ).toContain('account.reset_mfa');
  });

  it('needs a reason and refuses acting on yourself', async () => {
    await call(
      'post',
      `/users/${users.emp!.id}/actions/unlock`,
      users.admin!.token,
    )
      .send({ reason: 'x' })
      .expect(400);
    await call(
      'post',
      `/users/${users.admin!.id}/actions/sign-out-everywhere`,
      users.admin!.token,
    )
      .send({ reason: 'testing myself' })
      .expect(403);
  });

  it('an employee cannot manage accounts, and an HR user cannot reset a higher admin', async () => {
    await call('get', '/users', users.emp!.token).expect(403);
    await redis.client.set(`stepup:${users.hr2!.sessionId}`, '1', 'EX', 300);
    const r = await call(
      'post',
      `/users/${users.admin!.id}/actions/unlock`,
      users.hr2!.token,
    ).send({ reason: 'trying to reach up' });
    expect([403]).toContain(r.status);
  });

  it('suspend ends the sessions and reactivate brings the account back', async () => {
    await call(
      'post',
      `/users/${users.emp!.id}/actions/suspend`,
      users.admin!.token,
    )
      .send({ reason: 'Left the company' })
      .expect(200);
    await call('get', '/auth/me', users.emp!.token).expect(401);
    await call(
      'post',
      `/users/${users.emp!.id}/actions/reactivate`,
      users.admin!.token,
    )
      .send({ reason: 'Came back' })
      .expect(200);
  });
});

describe('two-step opt-out and My security (D-65)', () => {
  it('shows what My security may offer, and a REQUIRED role cannot turn two-step off', async () => {
    const info = await call('get', '/auth/security', users.admin!.token).expect(
      200,
    );
    expect(info.body).toMatchObject({ mfaEnabled: false });
    expect(Array.isArray(info.body.devices)).toBe(true);
    await call('post', '/auth/mfa/disable', users.admin!.token)
      .send({ password: PASSWORD })
      .expect((r) => expect([403, 409]).toContain(r.status));
  });
});
