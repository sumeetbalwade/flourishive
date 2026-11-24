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

const fakeMail = {
  send: async () => undefined,
  sendVia: async () => undefined,
  canResend: async () => false,
  retry: async () => false,
};

let app: INestApplication;
let prisma: PrismaService;
let tenantA = '';
let tenantB = '';
let adminA = '';
let empA = '';

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token?: string,
) => {
  const r = request(app.getHttpServer())[method](`/v1${path}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

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
  return (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
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
  await runAsSystem(async () => {
    await prisma.db.brandProfile.deleteMany({ where: { tenantId: null } });
  });
  tenantA = await tenant('brand-a');
  tenantB = await tenant('brand-b');
  adminA = await userWithRole(tenantA, 'admin@brand-a.test', 'tenant_admin');
  empA = await userWithRole(tenantA, 'emp@brand-a.test', 'employee');
});

afterAll(async () => {
  await runAsSystem(async () => {
    await prisma.db.brandProfile.deleteMany({ where: { tenantId: null } });
  });
  await deleteTenantData(prisma, 'brand-a');
  await deleteTenantData(prisma, 'brand-b');
  await app.close();
});

const ocean = {
  theme: { preset: 'ocean', accent: '#1f6fb2', defaultMode: 'dark' },
  signIn: {
    headline: 'Welcome to Brand A',
    tagline: '',
    bullets: ['One', 'Two'],
  },
};

describe('branding (D-61, D-62)', () => {
  it('is for people with brand.manage only', async () => {
    await call('get', '/brand', empA).expect(403);
    await call('put', '/brand/draft', empA).send({ draft: ocean }).expect(403);
  });

  it('serves the product brand to anyone, with a cache header', async () => {
    const r = await call('get', '/public/brand').expect(200);
    expect(r.headers['cache-control']).toContain('max-age=300');
    expect(r.body.theme.preset).toBe('mint');
  });

  it('keeps a draft private until it is published', async () => {
    await call('put', '/brand/draft', adminA)
      .send({ draft: ocean })
      .expect(200);
    const pub = await call('get', '/public/company/brand-a/brand').expect(200);
    expect(pub.body.theme.preset).toBe('mint');
    const st = await call('get', '/brand', adminA).expect(200);
    expect(st.body.hasDraft).toBe(true);
    expect(st.body.working.theme.preset).toBe('ocean');
  });

  it('blocks an unreadable accent with a reason', async () => {
    const r = await call('put', '/brand/draft', adminA)
      .send({
        draft: {
          theme: { preset: 'custom', accent: '#ffd400', defaultMode: 'light' },
        },
      })
      .expect(400);
    expect(JSON.stringify(r.body)).toMatch(/too light|easy to read/);
  });

  it('publishes, shows it to that company only, and reverts', async () => {
    await call('post', '/brand/publish', adminA).expect(200);
    const a = await call('get', '/public/company/brand-a/brand').expect(200);
    expect(a.body.theme.preset).toBe('ocean');
    expect(a.body.signIn.headline).toBe('Welcome to Brand A');
    const b = await call('get', '/public/company/brand-b/brand').expect(200);
    expect(b.body.theme.preset).toBe('mint');

    // A second version, then back.
    await call('put', '/brand/draft', adminA)
      .send({
        draft: {
          ...ocean,
          theme: { preset: 'plum', accent: '#000000', defaultMode: 'light' },
        },
      })
      .expect(200);
    await call('post', '/brand/publish', adminA).expect(200);
    expect(
      (await call('get', '/public/company/brand-a/brand')).body.theme.preset,
    ).toBe('plum');
    const rv = await call('post', '/brand/revert', adminA).expect(200);
    expect(rv.body.publishedVersion).toBe(3);
    expect(
      (await call('get', '/public/company/brand-a/brand')).body.theme.preset,
    ).toBe('ocean');
  });

  it('refuses to publish when there is nothing to publish, and ignores legal links from a company', async () => {
    await call('post', '/brand/publish', adminA).expect(409);
    await call('put', '/brand/draft', adminA)
      .send({
        draft: {
          ...ocean,
          legal: { termsUrl: 'https://evil.test/t', privacyUrl: '' },
        },
      })
      .expect(200);
    await call('post', '/brand/publish', adminA).expect(200);
    const a = await call('get', '/public/company/brand-a/brand').expect(200);
    expect(a.body.legal.termsUrl).toBe('');
  });

  it('shows the published brand in the company email layout preview', async () => {
    const r = await call('post', '/brand/preview/email', adminA)
      .send({
        draft: {
          displayName: 'Brand A HR',
          theme: ocean.theme,
          email: { footerText: 'Brand A footer', address: '1 Main St' },
        },
      })
      .expect(200);
    expect(r.body.html).toContain('Brand A HR');
    expect(r.body.html).toContain('Brand A footer');
    expect(r.body.html).toContain('#1f6fb2');
  });

  it('returns 404 for an unknown company', async () => {
    await call('get', '/public/company/nope-nope/brand').expect(404);
  });
});
