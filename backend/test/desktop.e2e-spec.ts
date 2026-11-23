import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { MfaService } from '../src/modules/identity/mfa.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import {
  RevocationChecker,
  RevocationUnavailable,
} from '../src/modules/signing/dsc/dsc-validator.js';
import { CertificateRevoked } from '../src/modules/signing/dsc/ocsp.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const fx = (n: string) =>
  readFileSync(resolve(process.cwd(), 'test/fixtures/dsc', n));
let app: INestApplication;
let prisma: PrismaService;
let ip = 0;
let tenantId = '';
let entityId = '';
let templateId = '';
let revocation: 'good' | 'revoked' | 'unavailable' = 'good';
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};

const call = (method: 'get' | 'post' | 'put', path: string, who: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.11.0.${++ip}`)
    .set('Authorization', `Bearer ${tok[who]}`);
const dev = (
  method: 'get' | 'post' | 'put',
  path: string,
  credential: string,
) =>
  request(app.getHttpServer())
    [method](`/v1/desktop${path}`)
    .set('X-Forwarded-For', `10.11.1.${++ip}`)
    .set('Authorization', `Device ${credential}`);
const pair = (code: string, name = 'HR laptop') =>
  request(app.getHttpServer())
    .post('/v1/desktop/pair')
    .set('X-Forwarded-For', `10.11.2.${++ip}`)
    .send({ code, name, platform: 'windows', appVersion: '1.0.0' });
const bin = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const c: Buffer[] = [];
    res.on('data', (x: Buffer) => c.push(x));
    res.on('end', () => cb(null, Buffer.concat(c)));
  });

async function user(name: string, roleKey: string) {
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  const u = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@dsk.test`, passwordHash },
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
  uid[name] = u.id;
  tok[name] = (
    await app.get(SessionService).start(tenantId, u.id, {})
  ).accessToken;
}

/** An approved document whose file is exactly the fixture the signed PDFs were made from. */
async function approvedFixtureDoc(): Promise<string> {
  const id = (
    await call('post', '/documents/generate', 'exec')
      .send({ templateId, entityId, fields: { recipientName: 'Asha' } })
      .expect(201)
  ).body.id as string;
  const file = await app.get(FilesService).storeTrusted(
    { tenantId, userId: uid.exec! },
    {
      body: fx('input.pdf'),
      mimeType: 'application/pdf',
      name: 'fixture.pdf',
      ownerType: 'document',
    },
  );
  await runInTenant(tenantId, async () => {
    await prisma.db.generatedDocument.update({
      where: { id },
      data: { fileId: file.id, sha256: file.sha256 },
    });
  });
  await call('post', `/documents/${id}/actions`, 'exec')
    .send({ action: 'submit' })
    .expect(201);
  await call('post', `/documents/${id}/actions`, 'admin')
    .send({ action: 'approve' })
    .expect(201);
  return id;
}
const stateOf = async (id: string) =>
  (await call('get', `/documents/${id}`, 'admin')).body.workflow
    .state as string;
const askDsc = (id: string, who = 'exec', signatory = 'lead') =>
  call('post', `/documents/${id}/signature-requests`, who).send({
    method: 'DSC',
    signatoryUserId: uid[signatory],
  });
async function pairedDevice(who = 'lead', name = 'HR laptop'): Promise<string> {
  const { body } = await call('post', '/desktop/pairing-code', who).expect(201);
  return (await pair(body.code, name).expect(201)).body.credential as string;
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .overrideProvider(RevocationChecker)
      .useValue({
        check: async () => {
          if (revocation === 'revoked') throw new CertificateRevoked(null);
          if (revocation === 'unavailable')
            throw new RevocationUnavailable(
              'The revocation server could not be reached',
            );
        },
      })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'dsk-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'dsk-a', name: 'Dsk A' },
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
  await user('admin', 'tenant_admin');
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
    .send({ entityId, letterType: 'OFFER', format: 'DK/{SEQ:4}' })
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
  await deleteTenantData(prisma, 'dsk-a');
  await app.close();
});
beforeEach(() => {
  revocation = 'good';
});

describe('pairing a signing computer', () => {
  it('gives a one-time code only to a signatory, and swaps it for a revocable credential', async () => {
    await call('post', '/desktop/pairing-code', 'exec').expect(403);
    const { body } = await call('post', '/desktop/pairing-code', 'lead').expect(
      201,
    );
    expect(body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.link).toMatch(/^flourishive:\/\/pair\?code=/);
    await pair('AAAA-AAAA').expect(400);
    const ok = await pair(body.code.toLowerCase().replace('-', ' ')).expect(
      201,
    ); // forgiving about how it was typed
    expect(ok.body.credential).toHaveLength(43);
    await pair(body.code).expect(400); // single use

    const cred = ok.body.credential as string;
    expect((await dev('get', '/me', cred).expect(200)).body.pollSeconds).toBe(
      30,
    );
    await dev('get', '/me', 'x'.repeat(43)).expect(401);
    await request(app.getHttpServer()).get('/v1/desktop/me').expect(401);
    // a device credential does not work as a login anywhere else
    await request(app.getHttpServer())
      .get('/v1/documents')
      .set('Authorization', `Device ${cred}`)
      .expect(401);

    const list = (await call('get', '/desktop/devices', 'lead').expect(200))
      .body;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(cred);
    await call('post', `/desktop/devices/${list[0].id}/revoke`, 'exec').expect(
      403,
    );
    await call('post', `/desktop/devices/${list[0].id}/revoke`, 'admin').expect(
      404,
    ); // not their device
    await call('post', `/desktop/devices/${list[0].id}/revoke`, 'lead').expect(
      201,
    );
    await dev('get', '/me', cred).expect(401);
  });
});

describe('certificate signing jobs', () => {
  it('only goes to a signatory, only for an approved document, one at a time', async () => {
    const draft = (
      await call('post', '/documents/generate', 'exec').send({
        templateId,
        entityId,
        fields: { recipientName: 'X' },
      })
    ).body.id;
    await askDsc(draft).expect(409); // not approved
    const id = await approvedFixtureDoc();
    await askDsc(id, 'exec', 'exec').expect(400); // an HR executive is not a signatory
    const r = await askDsc(id).expect(201);
    expect(r.body.status).toBe('PENDING');
    expect(await stateOf(id)).toBe('signing');
    await askDsc(id).expect(409);
  });

  it('lets one computer claim a job, hands over the exact file, and accepts the signed answer', async () => {
    const id = await approvedFixtureDoc();
    const job = (await askDsc(id).expect(201)).body;
    const a = await pairedDevice('lead', 'Laptop A');
    const b = await pairedDevice('lead', 'Laptop B');
    const adminDev = await pairedDevice('admin', 'Admin PC');

    const seen = (await dev('get', '/jobs', a).expect(200)).body;
    expect(seen.filter((j: { id: string }) => j.id === job.id)).toHaveLength(1);
    expect(seen.find((j: { id: string }) => j.id === job.id)).toMatchObject({
      letterType: 'OFFER',
      issuedBy: 'HQ Ltd',
    });
    expect((await dev('get', '/jobs', adminDev).expect(200)).body).toHaveLength(
      0,
    ); // not their job

    await dev('get', `/jobs/${job.id}/input`, a).expect(409); // must claim first
    const claim = (await dev('post', `/jobs/${job.id}/claim`, a).expect(201))
      .body;
    expect(claim.signature).toMatchObject({
      digest: 'sha256',
      timestampRequired: true,
      timestampUrl: 'http://timestamp.digicert.com',
      appearance: { visible: true, page: 0, box: [321.28, 70, 535.28, 118] },
    });
    await dev('post', `/jobs/${job.id}/claim`, b).expect(409); // held by A
    await dev('post', `/jobs/${job.id}/claim`, adminDev).expect(404);
    const input = (
      await bin(dev('get', `/jobs/${job.id}/input`, a).expect(200))
    ).body as Buffer;
    expect(input.equals(fx('input.pdf'))).toBe(true);

    const put = (cred: string, body: Buffer, type = 'application/pdf') =>
      dev('put', `/jobs/${job.id}/signed`, cred)
        .set('Content-Type', type)
        .send(body);
    await put(a, fx('signed-ok.pdf'), 'text/plain').expect(415);
    await put(a, Buffer.from('not a pdf')).expect(400);
    await put(b, fx('signed-ok.pdf')).expect(409); // B does not hold it

    // each refusal says why, never completes the job, and leaves it open for another try
    const refuse = async (name: string, code: string) => {
      const r = await put(a, fx(name)).expect(422);
      expect(r.body.code ?? r.body.message?.code).toBe(code);
    };
    await refuse('signed-untrusted.pdf', 'chain');
    await refuse('signed-no-timestamp.pdf', 'no-timestamp');
    await refuse('signed-expired.pdf', 'certificate-dates');
    await refuse('input.pdf', 'not-an-extension');
    revocation = 'revoked';
    await refuse('signed-ok.pdf', 'revoked');
    revocation = 'unavailable';
    const held = await put(a, fx('signed-ok.pdf')).expect(503);
    expect(JSON.stringify(held.body)).toContain('revocation-unavailable');
    expect(await stateOf(id)).toBe('signing');

    revocation = 'good';
    const done = await put(a, fx('signed-ok.pdf')).expect(200);
    expect(done.body).toMatchObject({ signed: true, test: false });
    expect(await stateOf(id)).toBe('issued');
    await put(a, fx('signed-ok.pdf')).expect(409); // already done

    // the evidence trail names the signer and what was tried before
    const req = (
      await call('get', `/documents/${id}/signature-requests`, 'lead').expect(
        200,
      )
    ).body[0];
    expect(req.status).toBe('COMPLETED');
    const types = req.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'requested',
        'claimed',
        'sign_rejected',
        'sign_held',
        'signed',
      ]),
    );
    const signed = req.events.find(
      (e: { type: string }) => e.type === 'signed',
    );
    expect(signed.meta).toMatchObject({
      signer: 'Noah Brooks (Test DSC)',
      issuer: 'Test Issuing CA',
      test: false,
    });

    // the public verify page now names the signer
    const token = await runAsSystem(
      async () =>
        (await prisma.db.generatedDocument.findUniqueOrThrow({ where: { id } }))
          .verifyToken,
    );
    const v = (
      await request(app.getHttpServer())
        .get(`/v1/public/verify/${token}`)
        .set('X-Forwarded-For', `10.11.3.${++ip}`)
        .expect(200)
    ).body;
    expect(v).toMatchObject({
      result: 'valid',
      test: false,
      signature: {
        signer: 'Noah Brooks (Test DSC)',
        organisation: 'Flourisense Test',
      },
    });
    const cmp = (b: Buffer) =>
      request(app.getHttpServer())
        .post(`/v1/public/verify/${token}/compare`)
        .set('X-Forwarded-For', `10.11.3.${++ip}`)
        .set('Content-Type', 'application/pdf')
        .send(b);
    expect((await cmp(fx('signed-ok.pdf')).expect(201)).body).toMatchObject({
      matches: 'signed-copy',
      seal: {
        intact: true,
        coversWholeFile: true,
        sealedByUs: true,
        laterSignatures: 1,
      },
    });
    const tampered = Buffer.from(fx('signed-ok.pdf'));
    tampered[tampered.indexOf('/Reason', fx('input.pdf').length) + 9] ^= 1;
    expect((await cmp(tampered).expect(201)).body.matches).toBe('different');
  });

  it('frees a job the app could not sign, lets a lapsed claim be taken, and stops an unpaired computer', async () => {
    const id = await approvedFixtureDoc();
    const job = (await askDsc(id).expect(201)).body;
    const a = await pairedDevice('lead', 'Laptop A');
    const b = await pairedDevice('lead', 'Laptop B');
    await dev('post', `/jobs/${job.id}/claim`, a).expect(201);
    await dev('post', `/jobs/${job.id}/fail`, a).send({}).expect(400);
    await dev('post', `/jobs/${job.id}/fail`, a)
      .send({ reason: 'Token not found' })
      .expect(201);
    await dev('post', `/jobs/${job.id}/claim`, b).expect(201); // free again
    await runInTenant(tenantId, async () => {
      await prisma.db.signatureRequest.update({
        where: { id: job.id },
        data: { claimExpiresAt: new Date(Date.now() - 1000) },
      });
    });
    await dev('post', `/jobs/${job.id}/claim`, a).expect(201); // B's lease lapsed
    await dev('post', `/jobs/${job.id}/release`, a).expect(201);

    const devices = (await call('get', '/desktop/devices', 'lead')).body as {
      id: string;
      name: string;
    }[];
    const mine = devices.find((d) => d.name === 'Laptop A')!;
    await call('post', `/desktop/devices/${mine.id}/revoke`, 'lead').expect(
      201,
    );
    await dev('get', '/jobs', a).expect(401);
    // and a person who lost the signing permission is stopped even with a valid credential
    await runInTenant(tenantId, async () => {
      const role = await prisma.db.role.findUniqueOrThrow({
        where: { tenantId_key: { tenantId, key: 'hr_lead' } },
      });
      await prisma.db.userRole.deleteMany({
        where: { userId: uid.lead, roleId: role.id },
      });
    });
    await app.get(RedisService).client.flushdb();
    await dev('get', '/jobs', b).expect(403);
  });
});

describe('signing without the token', () => {
  // the test above took the signatory's role away; give it back
  beforeAll(async () => {
    await runInTenant(tenantId, async () => {
      const role = await prisma.db.role.findUniqueOrThrow({
        where: { tenantId_key: { tenantId, key: 'hr_lead' } },
      });
      await prisma.db.userRole.create({
        data: { tenantId, userId: uid.lead!, roleId: role.id },
      });
    });
    await app.get(RedisService).client.flushdb();
  });

  const sealed = async (id: string) =>
    (
      await call('get', `/documents/${id}/signature-requests`, 'lead').expect(
        200,
      )
    ).body[0];

  it('is refused until the company switches it on, then needs the authenticator code', async () => {
    const id = await approvedFixtureDoc();
    await askDsc(id).expect(201);
    const cred = await pairedDevice();
    // earlier tests may have left other open jobs, so pick this document's own
    const mine = (await sealed(id)).id as string;
    const jobs = () => dev('get', '/jobs', cred).expect(200);
    const job = (await jobs()).body.find((j: { id: string }) => j.id === mine);
    expect(job.electronicAllowed).toBe(false);
    await dev('post', `/jobs/${job.id}/sign-electronically`, cred)
      .send({ code: '123456' })
      .expect(403);

    await app
      .get(SettingsService)
      .set(
        { tenantId, userId: uid.admin!, updatedBy: uid.admin! },
        'tenant',
        'signing.allowWithoutDsc',
        true,
      );
    expect(
      (await jobs()).body.find((j: { id: string }) => j.id === mine)
        .electronicAllowed,
    ).toBe(true);

    // no authenticator set up yet
    await dev('post', `/jobs/${job.id}/sign-electronically`, cred)
      .send({ code: '123456' })
      .expect(400);
    const mfa = app.get(MfaService);
    const enc = mfa.encryptSecret(mfa.newSecret());
    await runInTenant(tenantId, async () =>
      prisma.db.user.update({
        where: { id: uid.lead! },
        data: { mfaSecretEnc: enc, mfaEnabledAt: new Date() },
      }),
    );
    const wrong =
      (await mfa.currentCode(enc)) === '000000' ? '111111' : '000000';
    await dev('post', `/jobs/${job.id}/sign-electronically`, cred)
      .send({ code: wrong })
      .expect(400);
    await dev('post', `/jobs/${job.id}/sign-electronically`, cred)
      .send({ code: await mfa.currentCode(enc) })
      .expect(201);

    expect(await stateOf(id)).toBe('issued');
    expect(await sealed(id)).toMatchObject({
      method: 'SEAL',
      status: 'COMPLETED',
    });
    // the same job cannot be signed twice
    await dev('post', `/jobs/${job.id}/sign-electronically`, cred)
      .send({ code: await mfa.currentCode(enc) })
      .expect(409);

    // anyone checking the letter is told it was signed electronically, without a DSC
    const doc = (await call('get', `/documents/${id}`, 'admin').expect(200))
      .body;
    const v = await request(app.getHttpServer())
      .get(`/v1/public/verify/${doc.verifyToken}`)
      .set('X-Forwarded-For', `10.11.9.${++ip}`)
      .expect(200);
    expect(v.body.signature).toMatchObject({ kind: 'electronic' });
  });

  it('works from the web app for the signatory, and not for someone else', async () => {
    const id = await approvedFixtureDoc();
    await askDsc(id).expect(201);
    const opts = (
      await call(
        'get',
        `/documents/${id}/signature-requests/electronic`,
        'lead',
      ).expect(200)
    ).body;
    expect(opts.allowed).toBe(true);
    expect(opts.requestId).toBeTruthy();
    const none = (
      await call(
        'get',
        `/documents/${id}/signature-requests/electronic`,
        'admin',
      ).expect(200)
    ).body;
    expect(none.requestId).toBeNull();
    const mfa = app.get(MfaService);
    const enc = (
      await runInTenant(tenantId, async () =>
        prisma.db.user.findUniqueOrThrow({ where: { id: uid.lead! } }),
      )
    ).mfaSecretEnc!;
    await call(
      'post',
      `/documents/${id}/signature-requests/${opts.requestId}/sign-electronically`,
      'admin',
    )
      .send({ code: await mfa.currentCode(enc) })
      .expect(404);
    await call(
      'post',
      `/documents/${id}/signature-requests/${opts.requestId}/sign-electronically`,
      'lead',
    )
      .send({ code: await mfa.currentCode(enc) })
      .expect(201);
    expect(await stateOf(id)).toBe('issued');
  });
});
