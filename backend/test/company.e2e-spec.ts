import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { createTenantBody } from '@flourishive/schemas';
import { deleteTenantData } from './helpers.js';

const PASSWORD = 'correct horse battery';
const mails: { to: unknown; subject: string; text: string }[] = [];
let app: INestApplication;
let prisma: PrismaService;
let ip = 0;
const ids: Record<string, string> = {};

const call = (method: 'get' | 'post', path: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.9.0.${++ip}`);

async function company(slug: string, name: string, email: string) {
  await deleteTenantData(prisma, slug);
  const t = await runAsSystem(
    async () => await prisma.db.tenant.create({ data: { slug, name } }),
  );
  ids[slug] = t.id;
  await app.get(AccessService).provisionTenantRoles(t.id);
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId: t.id, email, passwordHash },
      }),
  );
}

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
  await app.get(RedisService).client.flushdb();
  await company('co-one', 'Company One', 'shared@co.test');
  await company('co-two', 'Company Two', 'shared@co.test');
  await company('co-three', 'Company Three', 'solo@co.test');
});

afterAll(async () => {
  for (const s of ['co-one', 'co-two', 'co-three'])
    await deleteTenantData(prisma, s);
  await app.close();
});

describe('company lookup', () => {
  it('shows a company its name and colour, and 404s for strangers', async () => {
    const res = await call('get', '/public/company/co-one').expect(200);
    expect(res.body).toEqual({
      slug: 'co-one',
      name: 'Company One',
      accentColor: '#2a9158',
    });
    await call('get', '/public/company/nope').expect(404);
    await call('get', '/public/company/_platform').expect(404);
    await runAsSystem(async () => {
      await prisma.db.tenant.update({
        where: { id: ids['co-three']! },
        data: { status: 'SUSPENDED' },
      });
    });
    await call('get', '/public/company/co-three').expect(404);
  });

  it('emails every sign-in address, and answers the same for strangers', async () => {
    mails.length = 0;
    await call('post', '/public/find-company')
      .send({ email: 'Shared@co.test' })
      .expect(202);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('http://co-one.localhost:5173');
    expect(mails[0]!.text).toContain('http://co-two.localhost:5173');

    mails.length = 0;
    await call('post', '/public/find-company')
      .send({ email: 'nobody@co.test' })
      .expect(202);
    await call('post', '/public/find-company')
      .send({ email: 'solo@co.test' })
      .expect(202);
    // solo@ belongs to a suspended company, so nothing is sent.
    expect(mails).toHaveLength(0);
  });
});

describe('sign-in from a company address', () => {
  const login = (origin: string | undefined, tenant: string) => {
    const r = call('post', '/auth/login');
    if (origin) r.set('Origin', origin);
    return r.send({ tenant, email: 'shared@co.test', password: PASSWORD });
  };

  it('works from its own address, and from app. or no origin', async () => {
    await login('http://co-one.localhost:5173', 'co-one').expect(200);
    await login('http://localhost:5173', 'co-one').expect(200);
    await login(undefined, 'co-two').expect(200);
  });

  it("refuses a page on one company's address trying another company", async () => {
    await login('http://co-one.localhost:5173', 'co-two').expect(400);
  });
});

describe('private links', () => {
  it('are emailed but not kept in the notifications table', async () => {
    mails.length = 0;
    await app
      .get(NotificationsService)
      .sendNow(ids['co-one']!, 'auth.password_reset', 'shared@co.test', {
        link: 'http://x/#/reset-password?token=SECRET123',
      });
    expect(mails.at(-1)!.text).toContain('SECRET123');
    const rows = await runInTenant(
      ids['co-one']!,
      async () => await prisma.db.notification.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).not.toContain('SECRET123');
    expect(rows[0]!.status).toBe('SENT');
    await expect(
      app
        .get(NotificationsService)
        .enqueue(ids['co-one']!, 'auth.invite', 'a@b.test', { link: 'x' }),
    ).rejects.toThrow();
  });
});

describe('company names', () => {
  const base = {
    name: 'X',
    companyName: 'X',
    legalName: 'X',
    adminEmail: 'a@b.test',
  };
  it('refuses names the platform keeps for itself', () => {
    for (const slug of ['app', 'admin', 'api', 'www', 'verify'])
      expect(createTenantBody.safeParse({ ...base, slug }).success).toBe(false);
    expect(
      createTenantBody.safeParse({ ...base, slug: 'acme-textiles' }).success,
    ).toBe(true);
  });
});
