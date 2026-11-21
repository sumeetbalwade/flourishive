import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { MfaService } from '../src/modules/identity/mfa.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { PlatformAdminService } from '../src/modules/platform-admin/platform-admin.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const mails: { to: unknown; subject: string; text: string }[] = [];
let app: INestApplication;
let prisma: PrismaService;
let tenantId = '';
const saved = { ...process.env };

beforeAll(async () => {
  // The whole product renamed and moved to another website, by configuration alone.
  process.env.APP_NAME = 'Acme HR';
  process.env.APP_DOMAIN = 'acmehr.com';
  delete process.env.TENANT_URL_TEMPLATE;
  delete process.env.WEB_URL;
  delete process.env.CORS_ORIGINS;
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
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'ren-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'ren-a', name: 'Rename A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: 'p@ren.test', passwordHash },
      }),
  );
});

afterAll(async () => {
  await deleteTenantData(prisma, 'ren-a');
  await app.close();
  process.env = saved;
});

describe('renamed product', () => {
  it('uses the new name in emails, the authenticator and the sender name', async () => {
    mails.length = 0;
    await request(app.getHttpServer())
      .post('/v1/auth/recovery/email')
      .send({ tenant: 'ren-a', email: 'p@ren.test' })
      .expect(202);
    expect(mails.at(-1)!.subject).toMatch(/^Your Acme HR code: \d{6}$/);

    await app
      .get(NotificationsService)
      .sendNow(tenantId, 'auth.invite', 'p@ren.test', { link: 'x' });
    expect(mails.at(-1)!.subject).toBe('You have been invited to Acme HR');

    const mfa = app.get(MfaService);
    expect(mfa.otpauthUri(mfa.newSecret(), 'p@ren.test')).toContain(
      'issuer=Acme%20HR',
    );

    expect(
      await app
        .get(SettingsService)
        .get('branding.emailSenderName', { tenantId }),
    ).toBe('Acme HR');
  });

  it('points company addresses at the new domain', async () => {
    mails.length = 0;
    await request(app.getHttpServer())
      .post('/v1/public/find-company')
      .send({ email: 'p@ren.test' })
      .expect(202);
    expect(mails.at(-1)!.text).toContain('https://ren-a.acmehr.com');
    expect(mails.at(-1)!.subject).toBe('Your Acme HR sign-in address');
  });

  it('keeps the new name for the platform, and tells settings screens the new default', async () => {
    await expect(
      app.get(PlatformAdminService).createTenant('actor', {
        slug: 'acme-hr',
        name: 'x',
        companyName: 'x',
        legalName: 'x',
        adminEmail: 'a@b.test',
      }),
    ).rejects.toThrow(/reserved/);
    const list = await app.get(PlatformAdminService).platformSettings();
    expect(
      list.find((s) => s.key === 'branding.emailSenderName')?.default,
    ).toBe('Acme HR');
  });
});
