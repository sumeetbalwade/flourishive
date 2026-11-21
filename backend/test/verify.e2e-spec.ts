import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
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

let app: INestApplication;
let prisma: PrismaService;
let ip = 0;
const T: Record<string, { id: string; entity: string; template: string }> = {};
const tok: Record<string, string> = {};
const mails: { text: string }[] = [];

const call = (method: 'get' | 'post' | 'put', path: string, who: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.10.0.${++ip}`)
    .set('Authorization', `Bearer ${tok[who]}`);
const pub = (method: 'get' | 'post', path: string, addr = `10.10.1.${++ip}`) =>
  request(app.getHttpServer())
    [method](`/v1/public${path}`)
    .set('X-Forwarded-For', addr);
const bin = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const c: Buffer[] = [];
    res.on('data', (x: Buffer) => c.push(x));
    res.on('end', () => cb(null, Buffer.concat(c)));
  });

async function tenant(slug: string) {
  await deleteTenantData(prisma, slug);
  const t = await runAsSystem(
    async () => await prisma.db.tenant.create({ data: { slug, name: slug } }),
  );
  await app.get(AccessService).provisionTenantRoles(t.id);
  const entity = (
    await runAsSystem(
      async () =>
        await prisma.db.entity.create({
          data: { tenantId: t.id, name: 'HQ', legalName: `${slug} Pvt Ltd` },
        }),
    )
  ).id;
  for (const [n, r] of [
    ['exec', 'hr_executive'],
    ['lead', 'hr_lead'],
  ] as const) {
    const u = await runAsSystem(
      async () =>
        await prisma.db.user.create({
          data: {
            tenantId: t.id,
            email: `${n}@${slug}.test`,
            passwordHash: await app.get(PasswordService).hash('x'),
          },
        }),
    );
    await runInTenant(t.id, async () => {
      const role = await prisma.db.role.findUnique({
        where: { tenantId_key: { tenantId: t.id, key: r } },
      });
      await prisma.db.userRole.create({
        data: { tenantId: t.id, userId: u.id, roleId: role!.id },
      });
    });
    tok[`${slug}:${n}`] = (
      await app.get(SessionService).start(t.id, u.id, {})
    ).accessToken;
  }
  const d = await PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const lead = `${slug}:lead`;
  await call('post', `/documents/letterheads?entityId=${entity}&name=L`, lead)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from(await d.save()))
    .expect(201);
  await call('put', '/documents/numbering', lead)
    .send({ entityId: entity, letterType: 'OFFER', format: 'SAME/{SEQ:4}' })
    .expect(200);
  const template = (
    await call('post', '/documents/templates', lead)
      .send({
        name: 'Offer',
        letterType: 'OFFER',
        layoutKey: 'letter',
        content: { body: 'Hello {{recipientName}}' },
      })
      .expect(201)
  ).body.id;
  T[slug] = { id: t.id, entity, template };
}
const gen = async (slug: string) =>
  (
    await call('post', '/documents/generate', `${slug}:exec`)
      .send({
        templateId: T[slug]!.template,
        entityId: T[slug]!.entity,
        fields: { recipientName: 'Asha Patil' },
      })
      .expect(201)
  ).body as { id: string; reference: string; verifyToken: string };
const approve = async (slug: string, id: string) => {
  await call('post', `/documents/${id}/actions`, `${slug}:exec`)
    .send({ action: 'submit' })
    .expect(201);
  await call('post', `/documents/${id}/actions`, `${slug}:lead`)
    .send({ action: 'approve' })
    .expect(201);
};

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async (m: never) => void mails.push(m) })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  await tenant('ver-a');
  await tenant('ver-b');
});
afterAll(async () => {
  await deleteTenantData(prisma, 'ver-a');
  await deleteTenantData(prisma, 'ver-b');
  await app.close();
});

describe('public verify', () => {
  it('knows nothing about drafts, and vouches for approved documents without personal data', async () => {
    const d = await gen('ver-a');
    const token =
      d.verifyToken ??
      (await runAsSystem(
        async () =>
          (
            await prisma.db.generatedDocument.findUniqueOrThrow({
              where: { id: d.id },
            })
          ).verifyToken,
      ));
    await pub('get', `/verify/${token}`).expect(404); // still a draft
    await approve('ver-a', d.id);
    const r = (await pub('get', `/verify/${token}`).expect(200)).body;
    expect(r).toMatchObject({
      result: 'pending',
      reference: d.reference,
      issuedBy: 'ver-a Pvt Ltd',
      letterType: 'OFFER',
      stage: 'approved',
      acceptance: null,
    });
    expect(JSON.stringify(r)).not.toMatch(/Asha|Patil|@/);
    await pub('get', '/verify/' + 'f'.repeat(32)).expect(404);
    await pub('get', '/verify/not-a-token').expect(404);
  });

  it('shows a document as valid once issued with a sealed acceptance, and compares files', async () => {
    const d = await gen('ver-a');
    const token = await runAsSystem(
      async () =>
        (
          await prisma.db.generatedDocument.findUniqueOrThrow({
            where: { id: d.id },
          })
        ).verifyToken,
    );
    await approve('ver-a', d.id);
    await call('post', `/documents/${d.id}/signature-requests`, 'ver-a:exec')
      .send({ name: 'Asha Patil', email: 'asha@c.test', finalStep: true })
      .expect(201);
    const link = /accept\/([A-Za-z0-9_-]+)/.exec(
      mails[mails.length - 1]!.text,
    )![1]!;
    await pub('post', `/accept/${link}/code`).expect(201);
    const code = / is (\d{6})\./.exec(mails[mails.length - 1]!.text)![1]!;
    await pub('post', `/accept/${link}/confirm`)
      .send({ code, consent: true })
      .expect(201);

    const r = (await pub('get', `/verify/${token}`).expect(200)).body;
    expect(r.result).toBe('valid');
    expect(r.acceptance).toMatchObject({ method: 'OTP', sealed: true });

    const sealed = (
      await bin(pub('get', `/accept/${link}/document`).expect(200))
    ).body as Buffer;
    const cmp = (b: Buffer) =>
      pub('post', `/verify/${token}/compare`)
        .set('Content-Type', 'application/pdf')
        .send(b);
    const same = (await cmp(sealed).expect(201)).body;
    expect(same).toMatchObject({
      matches: 'accepted-copy',
      seal: { intact: true, coversWholeFile: true, sealedByUs: true },
    });
    const tampered = Buffer.from(sealed);
    tampered[tampered.indexOf('stream\n') + 8] ^= 1;
    const t = (await cmp(tampered).expect(201)).body;
    expect(t.matches).toBe('different');
    expect(t.seal.intact).toBe(false);
    const edited = (
      await cmp(Buffer.concat([sealed, Buffer.from('\n%x\n')])).expect(201)
    ).body;
    expect(edited.matches).toBe('different');
    expect(edited.seal.coversWholeFile).toBe(false);
    await pub('post', `/verify/${token}/compare`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('not a pdf'))
      .expect(400);
  });

  it('looks up by company and reference, and never across companies', async () => {
    const a = await gen('ver-a');
    const b = await gen('ver-b'); // same reference text "SAME/…" can exist in both companies
    await approve('ver-a', a.id);
    await approve('ver-b', b.id);
    const ra = (
      await pub(
        'get',
        `/verify/lookup?company=ver-a&reference=${encodeURIComponent(a.reference)}`,
      ).expect(200)
    ).body;
    expect(ra.issuedBy).toBe('ver-a Pvt Ltd');
    expect(ra.token).toHaveLength(32);
    const rb = (
      await pub(
        'get',
        `/verify/lookup?company=ver-b&reference=${encodeURIComponent(b.reference)}`,
      ).expect(200)
    ).body;
    expect(rb.issuedBy).toBe('ver-b Pvt Ltd');
    expect(rb.token).not.toBe(ra.token);
    await pub(
      'get',
      `/verify/lookup?company=nope&reference=${encodeURIComponent(a.reference)}`,
    ).expect(404);
    await pub('get', `/verify/lookup?company=ver-a&reference=ZZZ/0001`).expect(
      404,
    );
  });

  it('limits how fast one address can check', async () => {
    const addr = '10.99.0.1';
    let blocked = 0;
    for (let i = 0; i < 70; i++)
      if ((await pub('get', '/verify/' + 'e'.repeat(32), addr)).status === 400)
        blocked++;
    expect(blocked).toBeGreaterThan(0);
  });
});
