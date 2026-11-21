import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { AuditWatchService } from '../src/modules/platform-admin/audit-watch.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

const mails: { to: unknown; subject: string; text: string }[] = [];
let app: INestApplication;
let prisma: PrismaService;
let tenantId = '';

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
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'watch-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'watch-a', name: 'Watch A' },
        }),
    )
  ).id;
  const audit = app.get(AuditService);
  for (let i = 0; i < 6; i++)
    await audit.record({
      tenantId,
      actorType: 'SYSTEM',
      actorId: null,
      action: `test.event_${i}`,
      entityType: 'tests',
      entityId: String(i),
    });
  await runAsSystem(async () => {
    await prisma.db.platformUser.deleteMany({
      where: { email: 'watcher@watch.test' },
    });
    await prisma.db.platformUser.create({
      data: { email: 'watcher@watch.test', status: 'ACTIVE' },
    });
  });
});

afterAll(async () => {
  await runAsSystem(async () => {
    await prisma.db.platformUser.deleteMany({
      where: { email: 'watcher@watch.test' },
    });
  });
  await deleteTenantData(prisma, 'watch-a');
  await app.close();
});

describe('nightly audit check', () => {
  it('passes quietly when every chain is intact', async () => {
    mails.length = 0;
    const r = await app.get(AuditWatchService).run();
    expect(r.rowsChecked).toBeGreaterThanOrEqual(6);
    expect(r.broken.map((b) => b.slug)).not.toContain('watch-a');
    expect(mails.filter((m) => /integrity/.test(m.subject))).toHaveLength(0);
  });

  it('emails platform admins and records the finding when a row was edited', async () => {
    const rows = await runAsSystem(
      async () =>
        await prisma.db.auditLog.findMany({
          where: { tenantId },
          orderBy: { seq: 'asc' },
        }),
    );
    const victim = rows[2]!;
    await runAsSystem(async () => {
      await prisma.db.auditLog.update({
        where: { seq: victim.seq },
        data: { action: 'tampered' },
      });
    });
    mails.length = 0;
    const r = await app.get(AuditWatchService).run();
    const mine = r.broken.find((b) => b.slug === 'watch-a');
    expect(mine?.seq).toBe(victim.seq.toString());

    const alert = mails.find((m) => /integrity check FAILED/.test(m.subject));
    expect(alert).toBeDefined();
    expect(JSON.stringify(alert!.to)).toContain('watcher@watch.test');
    expect(alert!.text).toContain('watch-a');

    const logged = await runAsSystem(
      async () =>
        await prisma.db.auditLog.findFirst({
          where: { action: 'platform.audit_chain_broken' },
          orderBy: { seq: 'desc' },
        }),
    );
    expect(logged).not.toBeNull();
  });
});
