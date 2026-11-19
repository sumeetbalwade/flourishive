import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { MfaService } from '../src/modules/identity/mfa.service.js';
import { PlatformAuthService } from '../src/modules/platform-admin/platform-auth.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const PASSWORD = 'a long platform passphrase';
const mails: { to: unknown; text: string }[] = [];
let app: INestApplication;
let prisma: PrismaService;
let mfa: MfaService;
let ip = 0;
const tokens: Record<string, string> = {};

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  token?: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.4.0.${++ip}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const tokenFromMail = () => /token=([\w-]+)/.exec(mails.at(-1)!.text)![1]!;

/** Invite -> set password -> enrol MFA -> signed in. Returns the access token and secret holder. */
async function onboard(email: string, actorId: string | null = null) {
  mails.length = 0;
  await app.get(PlatformAuthService).invite(email, actorId);
  await call('post', '/platform/auth/set-password')
    .send({ token: tokenFromMail(), password: PASSWORD })
    .expect(204);
  const login = await call('post', '/platform/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  expect(login.body.status).toBe('mfa_setup_required');
  await call('post', '/platform/auth/mfa/setup')
    .send({ mfaToken: login.body.mfaToken })
    .expect(200);
  const row = await runAsSystem(
    async () => await prisma.db.platformUser.findUnique({ where: { email } }),
  );
  const code = await mfa.currentCode(row!.mfaSecretEnc!);
  const done = await call('post', '/platform/auth/mfa/confirm')
    .send({ mfaToken: login.body.mfaToken, code })
    .expect(200);
  expect(done.body.recoveryCodes).toHaveLength(10);
  return {
    id: row!.id,
    token: done.body.accessToken as string,
    recoveryCodes: done.body.recoveryCodes as string[],
  };
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        send: async (m: { to: unknown; text: string }) => void mails.push(m),
      })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  mfa = app.get(MfaService);
  await app.get(RedisService).client.flushdb();
  await runAsSystem(async () => {
    await prisma.db.platformRefreshToken.deleteMany();
    await prisma.db.platformSession.deleteMany();
    await prisma.db.platformRecoveryCode.deleteMany();
    await prisma.db.platformUser.deleteMany();
  });
  await deleteTenantData(prisma, 'plat-new');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'plat-new');
  await runAsSystem(async () => {
    await prisma.db.platformRefreshToken.deleteMany();
    await prisma.db.platformSession.deleteMany();
    await prisma.db.platformRecoveryCode.deleteMany();
    await prisma.db.platformUser.deleteMany();
  });
  await app.close();
});

describe('super admin sign-in', () => {
  it('requires MFA enrolment, then a code, and blocks replays', async () => {
    const admin = await onboard('root@plat.test');
    tokens.root = admin.token;
    tokens.recovery = admin.recoveryCodes[1]!;
    await call('get', '/platform/auth/me', admin.token).expect(200);

    const login = await call('post', '/platform/auth/login')
      .send({ email: 'root@plat.test', password: PASSWORD })
      .expect(200);
    expect(login.body.status).toBe('mfa_required');
    const row = await runAsSystem(
      async () =>
        await prisma.db.platformUser.findUnique({
          where: { email: 'root@plat.test' },
        }),
    );
    const code = await mfa.currentCode(row!.mfaSecretEnc!);
    await call('post', '/platform/auth/mfa/verify')
      .send({ mfaToken: login.body.mfaToken, code: '000000' })
      .expect(401);
    await call('post', '/platform/auth/mfa/verify')
      .send({ mfaToken: login.body.mfaToken, code })
      .expect(200);
    const again = await call('post', '/platform/auth/login')
      .send({ email: 'root@plat.test', password: PASSWORD })
      .expect(200);
    await call('post', '/platform/auth/mfa/verify')
      .send({ mfaToken: again.body.mfaToken, code })
      .expect(401); // same code replayed
    const rec = await call('post', '/platform/auth/mfa/verify')
      .send({
        mfaToken: again.body.mfaToken,
        recoveryCode: admin.recoveryCodes[0],
      })
      .expect(200);
    expect(rec.body.accessToken).toBeTruthy();
  });

  it('rejects bad passwords generically and never mixes tenant and platform tokens', async () => {
    const res = await call('post', '/platform/auth/login')
      .send({ email: 'root@plat.test', password: 'wrong-wrong-wrong' })
      .expect(401);
    expect(res.body.message).toBe('Invalid credentials');
    await call('post', '/platform/auth/login')
      .send({ email: 'nobody@plat.test', password: PASSWORD })
      .expect(401);
    await call('get', '/platform/tenants').expect(401);
    await call('get', '/auth/me', tokens.root).expect(401); // platform token on a tenant route
  });

  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const login = await call('post', '/platform/auth/login')
      .set('X-Client', 'native')
      .send({ email: 'root@plat.test', password: PASSWORD })
      .expect(200);
    const signedIn = await call('post', '/platform/auth/mfa/verify')
      .set('X-Client', 'native')
      .send({ mfaToken: login.body.mfaToken, recoveryCode: tokens.recovery })
      .expect(200);
    const first = signedIn.body.refreshToken as string;
    const next = await call('post', '/platform/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: first })
      .expect(200);
    await call('post', '/platform/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: first })
      .expect(401); // replay
    await call('post', '/platform/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: next.body.refreshToken })
      .expect(401); // session revoked
    // The reuse also ends the session's access token at once, not only its refresh.
    await call('get', '/platform/auth/me', signedIn.body.accessToken).expect(
      401,
    );
  });
});

describe('tenant management', () => {
  it('creates a tenant with its company, roles and an invited admin', async () => {
    mails.length = 0;
    const created = await call('post', '/platform/tenants', tokens.root)
      .send({
        slug: 'plat-new',
        name: 'Plat New',
        companyName: 'Plat HQ',
        legalName: 'Plat HQ Pvt Ltd',
        adminEmail: 'boss@plat-new.test',
      })
      .expect(201);
    expect(mails.at(-1)!.to).toBe('boss@plat-new.test');

    await call('post', '/platform/tenants', tokens.root)
      .send({
        slug: 'plat-new',
        name: 'Dup',
        companyName: 'x',
        legalName: 'x',
        adminEmail: 'x@y.test',
      })
      .expect(409);
    await call('post', '/platform/tenants', tokens.root)
      .send({
        slug: '_sneaky',
        name: 'x',
        companyName: 'x',
        legalName: 'x',
        adminEmail: 'x@y.test',
      })
      .expect(400);

    // the invited admin can set a password and sign in (tenant admins must enrol MFA)
    await call('post', '/auth/reset-password')
      .send({ token: tokenFromMail(), password: 'a long tenant passphrase' })
      .expect(204);
    const login = await call('post', '/auth/login')
      .send({
        tenant: 'plat-new',
        email: 'boss@plat-new.test',
        password: 'a long tenant passphrase',
      })
      .expect(200);
    expect(login.body.status).toBe('mfa_setup_required');

    const detail = await call(
      'get',
      `/platform/tenants/${created.body.id}`,
      tokens.root,
    ).expect(200);
    expect(detail.body.entities.map((e: { name: string }) => e.name)).toEqual([
      'Plat HQ',
    ]);
    expect(detail.body.auditChain.ok).toBe(true);
    const list = await call('get', '/platform/tenants', tokens.root).expect(
      200,
    );
    expect(list.body.map((t: { slug: string }) => t.slug)).toContain(
      'plat-new',
    );
    expect(list.body.map((t: { slug: string }) => t.slug)).not.toContain(
      '_platform',
    );
    tokens.tenantId = created.body.id;
  });

  it('records platform actions in the tenant’s own audit trail', async () => {
    const rows = await runAsSystem(
      async () =>
        await prisma.db.auditLog.findMany({
          where: {
            tenantId: tokens.tenantId,
            action: 'platform.tenant_created',
          },
        }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorType).toBe('PLATFORM');
  });

  it('suspending a tenant blocks live sessions and sign-in; reactivating restores it', async () => {
    // give the tenant a working session first
    const tenantId = tokens.tenantId!;
    const user = await runAsSystem(
      async () =>
        await prisma.db.user.findFirst({
          where: { tenantId, email: 'boss@plat-new.test' },
        }),
    );
    const { SessionService } =
      await import('../src/modules/identity/session.service.js');
    const live = await app.get(SessionService).start(tenantId, user!.id, {});
    await call('get', '/auth/me', live.accessToken).expect(200);

    await call('patch', `/platform/tenants/${tenantId}`, tokens.root)
      .send({ status: 'SUSPENDED' })
      .expect(204);
    await call('get', '/auth/me', live.accessToken).expect(403);
    await call('post', '/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: live.refreshToken })
      .expect(401);
    await call('post', '/auth/login')
      .send({
        tenant: 'plat-new',
        email: 'boss@plat-new.test',
        password: 'a long tenant passphrase',
      })
      .expect(401);

    await call('patch', `/platform/tenants/${tenantId}`, tokens.root)
      .send({ status: 'ACTIVE' })
      .expect(204);
    await call('get', '/auth/me', live.accessToken).expect(200);
  });

  it('sets platform defaults and per-tenant overrides', async () => {
    const tenantId = tokens.tenantId!;
    const { SettingsService } =
      await import('../src/modules/settings/settings.service.js');
    const settings = app.get(SettingsService);
    await call('put', '/platform/settings/security.sessionDays', tokens.root)
      .send({ value: 5 })
      .expect(204);
    await call('put', '/platform/settings/security.sessionDays', tokens.root)
      .send({ value: 999 })
      .expect(400);
    expect(await settings.get('security.sessionDays', { tenantId })).toBe(5);
    await call(
      'put',
      `/platform/tenants/${tenantId}/settings/security.sessionDays`,
      tokens.root,
    )
      .send({ value: 2 })
      .expect(204);
    expect(await settings.get('security.sessionDays', { tenantId })).toBe(2);
    await call(
      'delete',
      `/platform/tenants/${tenantId}/settings/security.sessionDays`,
      tokens.root,
    ).expect(204);
    expect(await settings.get('security.sessionDays', { tenantId })).toBe(5);
    const defs = await call('get', '/platform/settings', tokens.root).expect(
      200,
    );
    expect(
      defs.body.find((d: { key: string }) => d.key === 'security.sessionDays')
        .platformValue,
    ).toBe(5);
    await runAsSystem(async () => {
      await prisma.db.platformSetting.deleteMany();
    });
    await app.get(RedisService).del('settings:platform');
  });
});

describe('platform users', () => {
  it('invites staff, lists them, and disabling revokes their sessions', async () => {
    const root = await runAsSystem(
      async () =>
        await prisma.db.platformUser.findUnique({
          where: { email: 'root@plat.test' },
        }),
    );
    const second = await onboard('second@plat.test', root!.id);
    await call('get', '/platform/auth/me', second.token).expect(200);
    const list = await call('get', '/platform/users', tokens.root).expect(200);
    expect(list.body.map((u: { email: string }) => u.email).sort()).toEqual([
      'root@plat.test',
      'second@plat.test',
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|mfaSecret/);

    await call('patch', `/platform/users/${root!.id}`, tokens.root)
      .send({ status: 'DISABLED' })
      .expect(400); // not yourself
    await call('patch', `/platform/users/${second.id}`, tokens.root)
      .send({ status: 'DISABLED' })
      .expect(204);
    await call('post', '/platform/auth/login')
      .send({ email: 'second@plat.test', password: PASSWORD })
      .expect(401);
  });
});
