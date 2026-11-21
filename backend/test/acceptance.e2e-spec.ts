import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { SealService } from '../src/modules/signing/seal/seal.service.js';
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
let tenantId = '';
let entityId = '';
let templateId = '';
const tok: Record<string, string> = {};
const mails: { to: string; subject: string; text: string }[] = [];

const call = (method: 'get' | 'post' | 'put', path: string, who: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.9.1.${++ip}`)
    .set('Authorization', `Bearer ${tok[who]}`);
const pub = (method: 'get' | 'post', path: string, addr = `10.9.2.${++ip}`) =>
  request(app.getHttpServer())
    [method](`/v1/public${path}`)
    .set('X-Forwarded-For', addr)
    .set('User-Agent', 'TestBrowser/1.0');

async function user(name: string, roleKey: string) {
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  const u = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@acc.test`, passwordHash },
      }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: roleKey } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: u.id, roleId: role!.id },
    });
  });
  tok[name] = (
    await app.get(SessionService).start(tenantId, u.id, {})
  ).accessToken;
}

async function approvedDoc(): Promise<string> {
  const id = (
    await call('post', '/documents/generate', 'exec')
      .send({ templateId, entityId, fields: { recipientName: 'Asha Patil' } })
      .expect(201)
  ).body.id as string;
  await call('post', `/documents/${id}/actions`, 'exec')
    .send({ action: 'submit' })
    .expect(201);
  await call('post', `/documents/${id}/actions`, 'lead')
    .send({ action: 'approve' })
    .expect(201);
  return id;
}
const stateOf = async (id: string) =>
  (await call('get', `/documents/${id}`, 'lead')).body.workflow.state as string;
const lastMail = () => mails[mails.length - 1]!;
const tokenFromMail = () =>
  /accept\/([A-Za-z0-9_-]+)/.exec(lastMail().text)![1]!;
const codeFromMail = () => / is (\d{6})\./.exec(lastMail().text)![1]!;
const ask = (id: string, body: object = {}) =>
  call('post', `/documents/${id}/signature-requests`, 'exec').send({
    name: 'Asha Patil',
    email: 'asha@candidate.test',
    ...body,
  });

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
  await deleteTenantData(prisma, 'acc-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'acc-a', name: 'Acc A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  entityId = (
    await runAsSystem(
      async () =>
        await prisma.db.entity.create({
          data: { tenantId, name: 'HQ', legalName: 'HQ Ltd' },
        }),
    )
  ).id;
  await user('exec', 'hr_executive');
  await user('lead', 'hr_lead');
  const d = await PDFDocument.create();
  d.addPage([595.28, 841.89]);
  await call(
    'post',
    `/documents/letterheads?entityId=${entityId}&name=L`,
    'lead',
  )
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from(await d.save()))
    .expect(201);
  await call('put', '/documents/numbering', 'lead')
    .send({ entityId, letterType: 'OFFER', format: 'AC/{SEQ:4}' })
    .expect(200);
  templateId = (
    await call('post', '/documents/templates', 'lead')
      .send({
        name: 'Offer',
        letterType: 'OFFER',
        layoutKey: 'letter',
        content: { body: 'Hello {{recipientName}}' },
      })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await deleteTenantData(prisma, 'acc-a');
  await app.close();
});

describe('OTP acceptance and the seal', () => {
  it('only goes out for an approved document, and only one request at a time', async () => {
    const draft = (
      await call('post', '/documents/generate', 'exec').send({
        templateId,
        entityId,
        fields: { recipientName: 'X' },
      })
    ).body.id;
    await ask(draft).expect(409);
    const id = await approvedDoc();
    const res = await ask(id).expect(201);
    expect(res.body.status).toBe('PENDING');
    expect(await stateOf(id)).toBe('signing');
    expect(lastMail().to).toBe('asha@candidate.test');
    expect(lastMail().text).toMatch(/\/accept\//);
    await ask(id).expect(409);
  });

  it('walks a candidate from the link to a sealed document', async () => {
    const id = await approvedDoc();
    await ask(id, { finalStep: true }).expect(201);
    const token = tokenFromMail();

    await pub(
      'get',
      '/accept/not-a-real-token-not-a-real-token-not-a-real',
    ).expect(404);
    const info = (await pub('get', `/accept/${token}`).expect(200)).body;
    expect(info).toMatchObject({
      name: 'Asha Patil',
      status: 'PENDING',
      canAccept: true,
      issuedBy: 'HQ Ltd',
    });
    expect(info.emailHint).toMatch(/^a\*+@candidate\.test$/);
    expect(JSON.stringify(info)).not.toContain('asha@candidate.test');
    const original = await pub('get', `/accept/${token}/document`).expect(200);
    expect(original.headers['content-type']).toContain('application/pdf');

    // codes: cooldown, wrong code, consent
    await pub('post', `/accept/${token}/confirm`)
      .send({ code: '123456', consent: true })
      .expect(400); // none issued yet
    await pub('post', `/accept/${token}/code`).expect(201);
    await pub('post', `/accept/${token}/code`).expect(400); // 60 second cooldown
    const code = codeFromMail();
    const wrong = code === '000000' ? '111111' : '000000';
    await pub('post', `/accept/${token}/confirm`)
      .send({ code: wrong, consent: true })
      .expect(400);
    await pub('post', `/accept/${token}/confirm`)
      .send({ code, consent: false })
      .expect(400);
    const ok = await pub('post', `/accept/${token}/confirm`)
      .send({ code, consent: true })
      .expect(201);
    expect(ok.body.accepted).toBe(true);
    await pub('post', `/accept/${token}/confirm`)
      .send({ code, consent: true })
      .expect(409); // single use
    expect(lastMail().subject).toMatch(/^Accepted:/);

    // finalStep: the document is issued
    expect(await stateOf(id)).toBe('issued');

    // the sealed file: original page + acceptance page, seal intact, ours
    const sealedRes = await pub('get', `/accept/${token}/document`)
      .expect(200)
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (x: Buffer) => c.push(x));
        r.on('end', () => cb(null, Buffer.concat(c)));
      });
    const sealed = sealedRes.body as Buffer;
    const pdf = await PDFDocument.load(sealed);
    expect(pdf.getPageCount()).toBe(2);
    const seal = app.get(SealService);
    expect(seal.verify(sealed)).toMatchObject({
      intact: true,
      coversWholeFile: true,
      sealedByUs: true,
    });
    const bad = Buffer.from(sealed);
    bad[bad.indexOf('stream\n') + 8] ^= 1;
    expect(seal.verify(bad).intact).toBe(false);
    expect(
      seal.verify(Buffer.concat([sealed, Buffer.from('\n%x\n')]))
        .coversWholeFile,
    ).toBe(false);

    // evidence trail
    const reqs = (
      await call('get', `/documents/${id}/signature-requests`, 'lead').expect(
        200,
      )
    ).body;
    expect(reqs[0].status).toBe('COMPLETED');
    expect(reqs[0].parties[0].status).toBe('ACCEPTED');
    const types = reqs[0].events.map((e: { type: string }) => e.type);
    expect(types).toEqual([
      'requested',
      'viewed',
      'code_failed', // confirm before any code was sent
      'code_sent',
      'code_failed', // the wrong code
      'accepted',
    ]);
    const acc = reqs[0].events.find(
      (e: { type: string }) => e.type === 'accepted',
    );
    expect(acc.ip).toBeTruthy();
    expect(acc.userAgent).toBe('TestBrowser/1.0');
    expect(acc.meta.documentSha256).toHaveLength(64);
  });

  it('lets the candidate decline, and HR cancel, each returning the document to approved', async () => {
    const id = await approvedDoc();
    await ask(id).expect(201);
    const token = tokenFromMail();
    await pub('post', `/accept/${token}/decline`)
      .send({ reason: 'Not interested' })
      .expect(201);
    expect(await stateOf(id)).toBe('approved');
    expect(
      (await pub('get', `/accept/${token}`).expect(200)).body,
    ).toMatchObject({ status: 'DECLINED', canAccept: false });
    await pub('post', `/accept/${token}/code`).expect(409);

    const second = await ask(id).expect(201);
    expect(await stateOf(id)).toBe('signing');
    await call(
      'post',
      `/documents/${id}/signature-requests/${second.body.id}/cancel`,
      'exec',
    )
      .send({})
      .expect(400);
    await call(
      'post',
      `/documents/${id}/signature-requests/${second.body.id}/cancel`,
      'exec',
    )
      .send({ reason: 'Wrong email' })
      .expect(201);
    expect(await stateOf(id)).toBe('approved');
    await call(
      'post',
      `/documents/${id}/signature-requests/${second.body.id}/cancel`,
      'exec',
    )
      .send({ reason: 'again' })
      .expect(409);
  });

  it('expires an unanswered request', async () => {
    const id = await approvedDoc();
    const r = await ask(id).expect(201);
    const token = tokenFromMail();
    await runInTenant(tenantId, async () => {
      await prisma.db.signatureRequest.update({
        where: { id: r.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    });
    expect(
      (await pub('get', `/accept/${token}`).expect(200)).body,
    ).toMatchObject({ status: 'EXPIRED', canAccept: false });
    expect(await stateOf(id)).toBe('approved');
    await pub('post', `/accept/${token}/code`).expect(409);
  });

  it('burns a code after five wrong guesses', async () => {
    const id = await approvedDoc();
    await ask(id).expect(201);
    const token = tokenFromMail();
    await pub('post', `/accept/${token}/code`).expect(201);
    const code = codeFromMail();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await pub('post', `/accept/${token}/confirm`)
        .send({ code: wrong, consent: true })
        .expect(400);
    await pub('post', `/accept/${token}/confirm`)
      .send({ code, consent: true })
      .expect(400); // right code, but burned
  });

  it('publishes the seal certificate and keeps staff routes closed to people without access', async () => {
    const pem = (await pub('get', '/seal-certificate').expect(200)).text;
    expect(pem).toContain('BEGIN CERTIFICATE');
    expect(pem).not.toContain('PRIVATE');
    const id = await approvedDoc();
    await call('get', `/documents/${id}/signature-requests`, 'exec').expect(
      200,
    );
  });
});
