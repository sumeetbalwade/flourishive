import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { FilesService } from '../src/modules/files/files.service.js';
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
let hrToken = '';
let managerToken = '';
let branchToken = '';
let firstDocId = '';
let templateId = '';

const call = (method: 'get' | 'post' | 'put', path: string, token = hrToken) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.7.0.${++ip}`)
    .set('Authorization', `Bearer ${token}`);

async function user(name: string, roleKey: string, scopeEntityId?: string) {
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  const u = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@doc.test`, passwordHash },
      }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: roleKey } },
    });
    await prisma.db.userRole.create({
      data: {
        tenantId,
        userId: u.id,
        roleId: role!.id,
        entityId: scopeEntityId ?? null,
      },
    });
  });
  return (await app.get(SessionService).start(tenantId, u.id, {})).accessToken;
}

async function pdfBytes(w: number, h: number) {
  const d = await PDFDocument.create();
  d.addPage([w, h]);
  return Buffer.from(await d.save());
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
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'doc-a');
  const t = await runAsSystem(
    async () =>
      await prisma.db.tenant.create({ data: { slug: 'doc-a', name: 'Doc A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  entityId = (
    await runAsSystem(
      async () =>
        await prisma.db.entity.create({
          data: { tenantId, name: 'HQ', legalName: 'HQ Pvt Ltd' },
        }),
    )
  ).id;
  hrToken = await user('hr', 'hr_lead');
  managerToken = await user('mgr', 'manager');
  const branch = await runAsSystem(
    async () =>
      await prisma.db.entity.create({
        data: { tenantId, name: 'Branch', legalName: 'Branch Ltd' },
      }),
  );
  branchToken = await user('branch', 'hr_lead', branch.id);
});

afterAll(async () => {
  await deleteTenantData(prisma, 'doc-a');
  await app.close();
});

describe('documents foundations', () => {
  it('refuses a letterhead of the wrong shape and accepts a good one', async () => {
    const q = `?entityId=${entityId}&name=HQ`;
    await call('post', `/documents/letterheads${q}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4 not really'))
      .expect(400);
    await call('post', `/documents/letterheads${q}&orientation=LANDSCAPE`)
      .set('Content-Type', 'application/pdf')
      .send(await pdfBytes(595, 842))
      .expect(400);
    const a = await call('post', `/documents/letterheads${q}`)
      .set('Content-Type', 'application/pdf')
      .send(await pdfBytes(595.28, 841.89))
      .expect(201);
    expect(a.body.version).toBe(1);
    const b = await call('post', `/documents/letterheads${q}`)
      .set('Content-Type', 'application/pdf')
      .send(await pdfBytes(595.28, 841.89))
      .expect(201);
    expect(b.body.version).toBe(2);
    await call(
      'post',
      `/documents/letterheads?entityId=${entityId}&name=HQ-L&orientation=LANDSCAPE`,
    )
      .set('Content-Type', 'application/pdf')
      .send(await pdfBytes(841.89, 595.28))
      .expect(201);
  });

  it('converts a PNG letterhead to PDF and records the stamp position', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await call(
      'post',
      `/documents/letterheads?entityId=${entityId}&name=Image&stampLeft=105&stampBottom=30`,
    )
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(201);
    expect(res.body.stampLeft).toBe(105);
    expect(res.body.stampBottom).toBe(30);
    await call('post', `/documents/letterheads?entityId=${entityId}&name=Bad`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not a png'))
      .expect(400);
  });

  it('validates numbering formats and the template wording', async () => {
    await call('put', '/documents/numbering')
      .send({ entityId, letterType: 'OFFER', format: 'NOSEQ' })
      .expect(400);
    await call('put', '/documents/numbering')
      .send({ entityId, letterType: 'OFFER', format: 'FS/{BAD}/{SEQ:4}' })
      .expect(400);
    await call('put', '/documents/numbering')
      .send({
        entityId,
        letterType: 'OFFER',
        format: 'FS/INT/{YYYY}/{SEQ:4}',
        startAt: 12,
      })
      .expect(200);
    await call('put', '/documents/numbering')
      .send({
        entityId,
        letterType: 'CERTIFICATE',
        format: 'FS/CERT/{YY}/{SEQ:3}',
      })
      .expect(200);
    await call('post', '/documents/templates')
      .send({
        name: 'Bad',
        letterType: 'OFFER',
        layoutKey: 'letter',
        content: { body: 'Hi {{nope}}' },
      })
      .expect(400);
    await call('post', '/documents/templates')
      .send({ name: 'Bad2', letterType: 'OFFER', layoutKey: 'missing' })
      .expect(400);
    const t = await call('post', '/documents/templates')
      .send({
        name: 'Offer',
        letterType: 'OFFER',
        layoutKey: 'letter',
        content: {
          subject: 'Offer of Internship / इंटर्नशिप का प्रस्ताव',
          body: '{{recipientName}} को स्वागत है. We offer you an internship starting {{start}}.\n\nSecond paragraph.',
          signatoryName: 'HR Lead',
          signatoryTitle: 'Head of HR',
        },
        fields: [
          { key: 'recipientName', label: 'Name', type: 'text', required: true },
          { key: 'start', label: 'Start', type: 'date', required: true },
        ],
      })
      .expect(201);
    templateId = t.body.id;
    expect(t.body.versions).toHaveLength(1);
    await call('post', '/documents/templates')
      .send({ name: 'Offer', letterType: 'OFFER', layoutKey: 'letter' })
      .expect(409);
  });

  it('generates a stamped PDF with the next reference, and never reuses a number', async () => {
    const gen = (fields: Record<string, string>) =>
      call('post', '/documents/generate').send({
        templateId,
        entityId,
        fields,
      });
    await gen({ recipientName: 'Asha' }).expect(400); // missing date, and no number burned
    await gen({ recipientName: 'Asha', start: 'tomorrow' }).expect(400);
    const first = await gen({
      recipientName: 'Asha Patil',
      start: '2026-12-01',
    }).expect(201);
    firstDocId = first.body.id;
    expect(first.body.reference).toMatch(/^FS\/INT\/\d{4}\/0012$/);
    const rest = await Promise.all(
      [1, 2, 3].map(() => gen({ recipientName: 'Ravi', start: '2026-12-01' })),
    );
    const refs = rest.map((r) => r.body.reference as string).sort();
    expect(rest.every((r) => r.status === 201)).toBe(true);
    expect(refs.map((r) => r.slice(-4))).toEqual(['0013', '0014', '0015']);

    const detail = await call('get', `/documents/${first.body.id}`).expect(200);
    const bytes = await app
      .get(FilesService)
      .openSigned(
        first.body.fileId,
        Number(
          new URL(detail.body.downloadUrl, 'http://x').searchParams.get(
            'expires',
          ),
        ),
        new URL(detail.body.downloadUrl, 'http://x').searchParams.get('sig')!,
      );
    const chunks: Buffer[] = [];
    for await (const c of bytes.stream) chunks.push(Buffer.from(c as Buffer));
    const pdf = await PDFDocument.load(Buffer.concat(chunks));
    expect(pdf.getPageCount()).toBe(first.body.pageCount);
    expect(pdf.getTitle()).toBe(first.body.reference);
    expect(detail.body.sha256).toHaveLength(64);
  });

  it('needs a letterhead in the right orientation and a numbering scheme', async () => {
    const t = await call('post', '/documents/templates')
      .send({ name: 'Cert', letterType: 'REFERENCE', layoutKey: 'certificate' })
      .expect(201);
    await call('post', '/documents/generate')
      .send({
        templateId: t.body.id,
        entityId,
        fields: {
          recipientName: 'A',
          startDate: '2026-01-01',
          endDate: '2026-02-01',
        },
      })
      .expect(400); // no numbering for REFERENCE
  });

  it('versions a template without changing the old version, and enforces permissions', async () => {
    const v = await call('post', `/documents/templates/${templateId}/versions`)
      .send({ content: { signatoryName: 'New Lead' } })
      .expect(201);
    expect(v.body.version).toBe(2);
    const t = await call('get', `/documents/templates/${templateId}`).expect(
      200,
    );
    expect(t.body.versions.map((x: { version: number }) => x.version)).toEqual([
      2, 1,
    ]);
    expect(t.body.versions[1].content.signatoryName).toBe('HR Lead');
    await call('get', '/documents', managerToken).expect(403);
    await call('post', '/documents/generate', managerToken)
      .send({})
      .expect(403);
    await call('get', '/documents').expect(200);
  });

  it('keeps a role limited to one company away from the others', async () => {
    const q = `?entityId=${entityId}&name=X`;
    await call('post', `/documents/letterheads${q}`, branchToken)
      .set('Content-Type', 'application/pdf')
      .send(await pdfBytes(595.28, 841.89))
      .expect(403);
    await call('put', '/documents/numbering', branchToken)
      .send({ entityId, letterType: 'OFFER', format: 'HACK/{SEQ:4}' })
      .expect(403);
    await call('post', '/documents/generate', branchToken)
      .send({
        templateId,
        entityId,
        fields: { recipientName: 'X', start: '2026-12-01' },
      })
      .expect(403);
    await call('get', `/documents/${firstDocId}`, branchToken).expect(404);
    const list = await call('get', '/documents', branchToken).expect(200);
    expect(list.body.items).toHaveLength(0);
    expect(
      (await call('get', '/documents/letterheads', branchToken)).body,
    ).toHaveLength(0);
    expect(
      (await call('get', '/documents/numbering', branchToken)).body,
    ).toHaveLength(0);
    expect(
      (await call('get', '/documents', hrToken)).body.items.length,
    ).toBeGreaterThan(0);
  });
});
