import { loadConfig } from '../config/config.js';
import { createPrismaClient } from '../database/prisma.service.js';
import { runAsSystem } from '../database/tenant-context.js';
import { JobRecordsService } from './job-records.service.js';

const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL!,
  FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
  HMAC_SECRET: 'x'.repeat(32),
});
const db = createPrismaClient(config.DATABASE_URL);
const enqueued: { name: string; jobId?: string }[] = [];
const queue = {
  enqueue: async (name: string, _d: unknown, o: { jobId?: string }) =>
    void enqueued.push({ name, jobId: o.jobId }),
};
const service = new JobRecordsService({ db } as never, queue as never);
let tenantId: string;

beforeAll(async () => {
  await runAsSystem(async () => {
    await db.jobRecord.deleteMany();
    await db.tenant.deleteMany({ where: { slug: 'jr-test' } });
    tenantId = (
      await db.tenant.create({ data: { slug: 'jr-test', name: 'JR' } })
    ).id;
  });
});
afterAll(async () => {
  await runAsSystem(async () => {
    await db.jobRecord.deleteMany();
    await db.tenant.deleteMany({ where: { slug: 'jr-test' } });
  });
  await db.$disconnect();
});

describe('JobRecordsService', () => {
  it('re-queues PENDING jobs older than the threshold, not DONE or fresh ones', async () => {
    const stale = await service.enqueue(tenantId, 'a', { n: 1 });
    const done = await service.enqueue(tenantId, 'b', { n: 2 });
    await service.markDone(tenantId, done);
    enqueued.length = 0;

    expect(
      await service.reconcile(60_000, new Date(Date.now() + 120_000)),
    ).toBe(1);
    expect(enqueued).toEqual([{ name: 'a', jobId: stale }]);

    enqueued.length = 0;
    expect(await service.reconcile(60_000)).toBe(0);
  });
});
