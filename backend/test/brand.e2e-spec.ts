import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
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

  it('shows a signed-in person their own company brand, whatever their role', async () => {
    const r = await call('get', '/brand/current', empA).expect(200);
    expect(r.body.theme.preset).toBe('ocean');
    await call('get', '/brand/current').expect(401);
  });

  it('returns 404 for an unknown company', async () => {
    await call('get', '/public/company/nope-nope/brand').expect(404);
  });

  describe('pictures', () => {
    const png = (w = 64, h = 64) =>
      sharp({
        create: { width: w, height: h, channels: 4, background: '#1f6fb2' },
      })
        .png()
        .toBuffer();
    const up = (
      kind: string,
      body: Buffer,
      type = 'image/png',
      token = adminA,
    ) =>
      request(app.getHttpServer())
        .post(`/v1/brand/assets?kind=${kind}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', type)
        .send(body);

    it('is for people with brand.manage only', async () => {
      await up('LOGO_LIGHT', await png(), 'image/png', empA).expect(403);
    });

    it('refuses HTML and a renamed program', async () => {
      await up('LOGO_LIGHT', Buffer.from('<html></html>'), 'image/png').expect(
        415,
      );
      await up(
        'LOGO_LIGHT',
        Buffer.from('MZ'.padEnd(64, '\0')),
        'image/png',
      ).expect(415);
    });

    it('cleans an SVG of script and shrinks a big picture', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><circle r="4"/></svg>',
      );
      const r = await up('LOGO_LIGHT', svg, 'image/svg+xml').expect(201);
      const served = await request(app.getHttpServer())
        .get(`/v1/public/brand-assets/${r.body.id}`)
        .buffer(true)
        .expect(200);
      expect(served.headers['content-type']).toContain('image/svg+xml');
      expect(served.headers['content-security-policy']).toBe('sandbox');
      const text = Buffer.from(served.body).toString();
      expect(text).not.toMatch(/script|onload/i);
      expect(text).toContain('<circle');

      const big = await up('LOGO_LIGHT', await png(3000, 1000)).expect(201);
      expect(big.body.width).toBe(512);
    });

    it('turns a favicon into a square PNG and offers an .ico', async () => {
      const r = await up('FAVICON', await png(300, 100)).expect(201);
      expect([r.body.width, r.body.height]).toEqual([64, 64]);
      const ico = await request(app.getHttpServer())
        .get(`/v1/public/brand-assets/${r.body.id}/favicon.ico`)
        .expect(200);
      expect(ico.headers['content-type']).toContain('image/x-icon');
      await request(app.getHttpServer())
        .get(`/v1/public/brand-assets/${r.body.id}/favicon.ico`)
        .expect(200);
    });

    it('stores a logo, serves it safely, and a brand can use only its own pictures', async () => {
      const r = await up('LOGO_LIGHT', await png()).expect(201);
      const served = await request(app.getHttpServer())
        .get(`/v1/public/brand-assets/${r.body.id}`)
        .expect(200);
      expect(served.headers['content-security-policy']).toBe('sandbox');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-type']).toContain('image/png');

      const assets = {
        logoLight: r.body.id,
        logoDark: '',
        favicon: '',
        panelImage: '',
      };
      await call('put', '/brand/draft', adminA)
        .send({ draft: { assets } })
        .expect(200);
      await call('put', '/brand/draft', adminA)
        .send({
          draft: { assets: { ...assets, logoLight: '', favicon: r.body.id } },
        })
        .expect(400);
      const adminB = await userWithRole(
        tenantB,
        'admin@brand-b.test',
        'tenant_admin',
      );
      await call('put', '/brand/draft', adminB)
        .send({ draft: { assets } })
        .expect(400);

      await call('post', '/brand/publish', adminA).expect(200);
      const pub = await call('get', '/public/company/brand-a/brand').expect(
        200,
      );
      expect(pub.body.assets.logoLight).toBe(r.body.id);
      const other = await call('get', '/public/company/brand-b/brand').expect(
        200,
      );
      expect(other.body.assets.logoLight).toBe('');
    });

    it('returns 404 for an unknown picture', async () => {
      await request(app.getHttpServer())
        .get('/v1/public/brand-assets/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
