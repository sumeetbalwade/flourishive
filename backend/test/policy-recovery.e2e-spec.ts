import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { RolePolicyService } from '../src/modules/access/role-policy.service.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { PlatformAdminService } from '../src/modules/platform-admin/platform-admin.service.js';
import { MfaService } from '../src/modules/identity/mfa.service.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { PlatformAuthService } from '../src/modules/platform-admin/platform-auth.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const PASSWORD = 'correct horse battery';
const mails: { to: unknown; subject: string; text: string }[] = [];
let app: INestApplication;
let prisma: PrismaService;
let policies: RolePolicyService;
let settings: SettingsService;
let tenantId = '';
let adminToken = '';
let ip = 0;

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token?: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.7.0.${++ip}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const lastCode = () => /\b(\d{6})\b/.exec(mails.at(-1)!.text)![1]!;

async function makeUser(email: string, roleKey?: string) {
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email, passwordHash },
      }),
  );
  if (roleKey)
    await runInTenant(tenantId, async () => {
      const role = await prisma.db.role.findUnique({
        where: { tenantId_key: { tenantId, key: roleKey } },
      });
      await prisma.db.userRole.create({
        data: { tenantId, userId: user.id, roleId: role!.id },
      });
    });
  return user;
}
const enrolMfa = async (userId: string) => {
  const mfa = app.get(MfaService);
  await runInTenant(tenantId, async () => {
    await prisma.db.user.update({
      where: { id: userId },
      data: {
        mfaSecretEnc: mfa.encryptSecret(mfa.newSecret()),
        mfaEnabledAt: new Date(),
      },
    });
    await prisma.db.recoveryCode.create({
      data: { tenantId, userId, codeHash: 'a'.repeat(64) },
    });
  });
};
const login = (email: string, password = PASSWORD) =>
  call('post', '/auth/login').send({ tenant: 'pol-a', email, password });

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        send: async (m: { to: unknown; subject: string; text: string }) =>
          void mails.push(m),
      })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  policies = app.get(RolePolicyService);
  settings = app.get(SettingsService);
  await app.get(RedisService).client.flushdb();
  await runAsSystem(async () => {
    await prisma.db.platformSetting.deleteMany();
    await prisma.db.platformRolePolicy.deleteMany();
  });
  await deleteTenantData(prisma, 'pol-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'pol-a', name: 'Policy A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const admin = await makeUser('admin@pol-a.test', 'tenant_admin');
  adminToken = (await app.get(SessionService).start(tenantId, admin.id, {}))
    .accessToken;
});

afterAll(async () => {
  await runAsSystem(async () => {
    await prisma.db.platformSetting.deleteMany();
    await prisma.db.platformRolePolicy.deleteMany();
    await prisma.db.platformRefreshToken.deleteMany();
    await prisma.db.platformSession.deleteMany();
    await prisma.db.platformRecoveryCode.deleteMany();
    await prisma.db.platformUser.deleteMany();
  });
  await deleteTenantData(prisma, 'pol-a');
  await app.close();
});

describe('two-step policy per role', () => {
  it('lists each role with its floor, and refuses to go below it', async () => {
    const res = await call('get', '/access/policies', adminToken).expect(200);
    const byKey = Object.fromEntries(
      res.body.map((r: { roleKey: string }) => [r.roleKey, r]),
    );
    expect(byKey.hr_lead).toMatchObject({
      mfaLevel: 'REQUIRED',
      mfaFloor: 'REQUIRED',
    });
    expect(byKey.employee).toMatchObject({
      mfaLevel: 'OPTIONAL',
      mfaFloor: 'OFF',
    });
    await call('put', '/access/policies/hr_lead', adminToken)
      .send({ mfaLevel: 'OPTIONAL' })
      .expect(400);
    await call('put', '/access/policies/manager', adminToken)
      .send({ mfaLevel: 'OFF', recoveryEmail: false })
      .expect(204);
  });

  it('adds a custom role with its own policy', async () => {
    const created = await call('post', '/access/roles', adminToken)
      .send({ name: 'Finance reviewer', mfaLevel: 'REQUIRED' })
      .expect(201);
    expect(created.body.key).toBe('custom_finance_reviewer');
    await call('post', '/access/roles', adminToken)
      .send({ name: 'Finance reviewer' })
      .expect(409);
    const res = await call('get', '/access/policies', adminToken);
    expect(
      res.body.find((r: { roleKey: string }) => r.roleKey === created.body.key),
    ).toMatchObject({ isSystem: false, mfaLevel: 'REQUIRED', mfaFloor: 'OFF' });
  });

  it('raising the platform floor lifts a company that was below it', async () => {
    await policies.setPlatformPolicy('manager', { mfaFloor: 'OPTIONAL' });
    const mgr = (await policies.tenantPolicies(tenantId)).find(
      (p) => p.roleKey === 'manager',
    );
    expect(mgr).toMatchObject({ mfaLevel: 'OPTIONAL', mfaFloor: 'OPTIONAL' });
    await call('put', '/access/policies/manager', adminToken)
      .send({ mfaLevel: 'OFF' })
      .expect(400);
    await expect(
      policies.setPlatformPolicy('manager', {
        mfaLevel: 'OFF',
        mfaFloor: 'OPTIONAL',
      }),
    ).rejects.toThrow();
  });

  it('is enforced at sign-in by the strictest role', async () => {
    await makeUser('emp@pol-a.test', 'employee');
    expect((await login('emp@pol-a.test')).body.status).toBe('ok');
    await call('put', '/access/policies/employee', adminToken)
      .send({ mfaLevel: 'REQUIRED' })
      .expect(204);
    expect((await login('emp@pol-a.test')).body.status).toBe(
      'mfa_setup_required',
    );
    const me = await call('get', '/auth/me', adminToken).expect(200);
    expect(me.body.mfaLevel).toBe('REQUIRED');
    await call('put', '/access/policies/employee', adminToken)
      .send({ mfaLevel: 'OFF' })
      .expect(204);
    expect((await login('emp@pol-a.test')).body.status).toBe('ok');
  });
});

describe('locking a platform setting', () => {
  it('beats the company override and blocks changing it', async () => {
    await call('put', '/settings/tenant/security.passwordMinLength', adminToken)
      .send({ value: 10 })
      .expect(204);
    await settings.setPlatform('security.passwordMinLength', 14, true);
    expect(await settings.get('security.passwordMinLength', { tenantId })).toBe(
      14,
    );
    await call('put', '/settings/tenant/security.passwordMinLength', adminToken)
      .send({ value: 9 })
      .expect(400);
    const all = await call('get', '/settings', adminToken).expect(200);
    expect(all.body.locked).toContain('security.passwordMinLength');
    expect(all.body.values['platform.superAdminMfa']).toBeUndefined();

    await settings.setPlatform('security.passwordMinLength', undefined, false);
    expect(await settings.get('security.passwordMinLength', { tenantId })).toBe(
      10,
    );
  });

  it('keeps platform-only settings away from companies', async () => {
    await expect(
      settings.setPlatform('platform.superAdminMfa', 'OPTIONAL', true),
    ).rejects.toThrow();
    await call('put', '/settings/tenant/platform.superAdminMfa', adminToken)
      .send({ value: 'OFF' })
      .expect(400);
  });
});

describe('email OTP recovery', () => {
  it('resets a forgotten password with an emailed code', async () => {
    await makeUser('pw@pol-a.test', 'employee');
    mails.length = 0;
    await call('post', '/auth/recovery/email')
      .send({ tenant: 'pol-a', email: 'pw@pol-a.test' })
      .expect(202);
    expect(mails).toHaveLength(1);
    const code = lastCode();

    await call('post', '/auth/recovery/email/verify')
      .send({
        tenant: 'pol-a',
        email: 'pw@pol-a.test',
        code: code === '000000' ? '111111' : '000000',
      })
      .expect(401);
    const ok = await call('post', '/auth/recovery/email/verify')
      .send({ tenant: 'pol-a', email: 'pw@pol-a.test', code })
      .expect(200);
    // A code works once.
    await call('post', '/auth/recovery/email/verify')
      .send({ tenant: 'pol-a', email: 'pw@pol-a.test', code })
      .expect(401);
    await call('post', '/auth/reset-password')
      .send({ token: ok.body.resetToken, password: 'a brand new passphrase' })
      .expect(204);
    expect(
      (await login('pw@pol-a.test', 'a brand new passphrase')).body.status,
    ).toBe('ok');
  });

  it('says nothing for unknown accounts and roles that may not use it', async () => {
    mails.length = 0;
    await call('post', '/auth/recovery/email')
      .send({ tenant: 'pol-a', email: 'nobody@pol-a.test' })
      .expect(202);
    await makeUser('mgr@pol-a.test', 'manager');
    await call('put', '/access/policies/manager', adminToken)
      .send({ recoveryEmail: false })
      .expect(204);
    await call('post', '/auth/recovery/email')
      .send({ tenant: 'pol-a', email: 'mgr@pol-a.test' })
      .expect(202);
    expect(mails).toHaveLength(0);
  });

  it('burns a code after five wrong guesses, even if the right one follows', async () => {
    const otp = app.get(OtpService);
    const code = await otp.issue('password', 'subject-1', 60);
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++)
      expect(await otp.verify('password', 'subject-1', wrong)).toBe(false);
    expect(await otp.verify('password', 'subject-1', code)).toBe(false);

    const fresh = await otp.issue('password', 'subject-2', 60);
    expect(await otp.verify('password', 'subject-2', wrong)).toBe(false);
    expect(await otp.verify('password', 'subject-2', fresh)).toBe(true);
    expect(await otp.verify('password', 'subject-2', fresh)).toBe(false);
  });

  it('lets someone who lost their authenticator start again, after the password', async () => {
    const u = await makeUser('lost@pol-a.test', 'hr_lead');
    await enrolMfa(u.id);
    const first = await login('lost@pol-a.test');
    expect(first.body.status).toBe('mfa_required');

    mails.length = 0;
    await call('post', '/auth/mfa/recovery/email')
      .send({ mfaToken: first.body.mfaToken })
      .expect(202);
    await call('post', '/auth/mfa/recovery/email/verify')
      .send({ mfaToken: first.body.mfaToken, code: '000000' })
      .expect(401);
    const res = await call('post', '/auth/mfa/recovery/email/verify')
      .send({ mfaToken: first.body.mfaToken, code: lastCode() })
      .expect(200);
    expect(res.body.status).toBe('mfa_setup_required');
    const row = await runInTenant(
      tenantId,
      async () => await prisma.db.user.findUnique({ where: { id: u.id } }),
    );
    expect(row?.mfaEnabledAt).toBeNull();
    expect(
      await runInTenant(
        tenantId,
        async () =>
          await prisma.db.recoveryCode.count({ where: { userId: u.id } }),
      ),
    ).toBe(0);
  });

  it('refuses the authenticator reset when the role has email recovery off', async () => {
    await call('put', '/access/policies/hr_executive', adminToken)
      .send({ recoveryEmail: false })
      .expect(204);
    const u = await makeUser('noreset@pol-a.test', 'hr_executive');
    await enrolMfa(u.id);
    const first = await login('noreset@pol-a.test');
    await call('post', '/auth/mfa/recovery/email')
      .send({ mfaToken: first.body.mfaToken })
      .expect(403);
  });
});

describe('super admin two-step policy', () => {
  it('lets platform staff in with a password alone when the policy is optional', async () => {
    await settings.setPlatform('platform.superAdminMfa', 'OPTIONAL');
    const auth = app.get(PlatformAuthService);
    mails.length = 0;
    await auth.invite('opt@plat-pol.test', null);
    const token = /token=([\w-]+)/.exec(mails.at(-1)!.text)![1]!;
    await call('post', '/platform/auth/set-password')
      .send({ token, password: 'a long platform passphrase' })
      .expect(204);
    const res = await call('post', '/platform/auth/login')
      .send({
        email: 'opt@plat-pol.test',
        password: 'a long platform passphrase',
      })
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.accessToken).toBeTruthy();

    await settings.setPlatform('platform.superAdminMfa', 'REQUIRED');
    const again = await call('post', '/platform/auth/login')
      .send({
        email: 'opt@plat-pol.test',
        password: 'a long platform passphrase',
      })
      .expect(200);
    expect(again.body.status).toBe('mfa_setup_required');
  });
});

describe('super admin lost authenticator', () => {
  const pass = 'a long platform passphrase';
  async function enrolled(email: string) {
    const auth = app.get(PlatformAuthService);
    mails.length = 0;
    await auth.invite(email, null);
    const token = /token=([\w-]+)/.exec(mails.at(-1)!.text)![1]!;
    await call('post', '/platform/auth/set-password')
      .send({ token, password: pass })
      .expect(204);
    const mfa = app.get(MfaService);
    await runAsSystem(async () => {
      await prisma.db.platformUser.update({
        where: { email },
        data: {
          mfaSecretEnc: mfa.encryptSecret(mfa.newSecret()),
          mfaEnabledAt: new Date(),
        },
      });
    });
    return (
      await call('post', '/platform/auth/login')
        .send({ email, password: pass })
        .expect(200)
    ).body.mfaToken as string;
  }

  it('emails a code that clears the old authenticator and starts setup again', async () => {
    await settings.setPlatform('platform.superAdminMfa', 'REQUIRED');
    const mfaToken = await enrolled('lost@plat-pol.test');
    mails.length = 0;
    await call('post', '/platform/auth/mfa/recovery/email')
      .send({ mfaToken })
      .expect(202);
    expect(mails).toHaveLength(1);
    await call('post', '/platform/auth/mfa/recovery/email/verify')
      .send({ mfaToken, code: '000000' })
      .expect(401);
    const res = await call('post', '/platform/auth/mfa/recovery/email/verify')
      .send({ mfaToken, code: lastCode() })
      .expect(200);
    expect(res.body.status).toBe('mfa_setup_required');
    const row = await runAsSystem(
      async () =>
        await prisma.db.platformUser.findUnique({
          where: { email: 'lost@plat-pol.test' },
        }),
    );
    expect(row?.mfaEnabledAt).toBeNull();
  });

  it('refuses when email recovery is turned off for platform staff', async () => {
    await settings.setPlatform('platform.superAdminRecoveryEmail', false);
    const mfaToken = await enrolled('noreset@plat-pol.test');
    await call('post', '/platform/auth/mfa/recovery/email')
      .send({ mfaToken })
      .expect(403);
    await settings.setPlatform('platform.superAdminRecoveryEmail', true);
  });
});

describe('technical settings', () => {
  it('tells the settings screen what control to draw', async () => {
    const list = await app.get(PlatformAdminService).platformSettings();
    const by = Object.fromEntries(list.map((x) => [x.key, x]));
    expect(by['security.passwordMinLength']).toMatchObject({
      kind: 'number',
      min: 8,
      max: 64,
      group: 'Security',
    });
    expect(by['platform.superAdminMfa']).toMatchObject({
      kind: 'enum',
      options: ['OFF', 'OPTIONAL', 'REQUIRED'],
      group: 'Platform',
    });
    expect(by['platform.superAdminRecoveryEmail'].kind).toBe('boolean');
    expect(by['branding.accentColor'].kind).toBe('color');
    expect(by['branding.emailSenderName'].kind).toBe('text');
  });

  it('locks sign-in after the number of wrong passwords the company chose', async () => {
    await makeUser('lockme@pol-a.test', 'employee');
    await settings.set(
      { tenantId, updatedBy: 'test' },
      'tenant',
      'security.loginAttempts',
      3,
    );
    const attempt = (password: string) =>
      request(app.getHttpServer())
        .post('/v1/auth/login')
        .set('X-Forwarded-For', '10.55.0.1')
        .send({ tenant: 'pol-a', email: 'lockme@pol-a.test', password });
    for (let i = 0; i < 3; i++) await attempt('wrong password!!').expect(401);
    await attempt(PASSWORD).expect(429);
  });

  it('limits uploads to the size the company chose', async () => {
    await settings.set(
      { tenantId, updatedBy: 'test' },
      'tenant',
      'files.maxUploadMb',
      1,
    );
    const body = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    const who = { tenantId, userId: (await makeUser('up@pol-a.test')).id };
    await expect(
      app.get(FilesService).upload(who, {
        body,
        mimeType: 'application/pdf',
        name: 'big.pdf',
      }),
    ).rejects.toThrow(/at most 1 MB/);
  });
});
