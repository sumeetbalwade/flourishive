import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { runAsSystem, runInTenant } from '../database/tenant-context.js';
import { currentRequestId } from '../http/request-id.js';
import { QueueService } from './queue.service.js';

/**
 * Important jobs are written to MySQL first, then queued. If Redis loses data,
 * the reconciler re-queues rows still PENDING after `staleAfterMs` (D-30).
 * Handlers must be idempotent; the job id is the record id, so a job that is
 * still in Redis is not queued twice.
 */
@Injectable()
export class JobRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async enqueue(
    tenantId: string,
    name: string,
    payload: object,
  ): Promise<string> {
    // Remember which request asked for this job, so a trace can show it.
    const requestId = currentRequestId();
    const stored =
      requestId && !('requestId' in payload)
        ? { ...payload, requestId }
        : payload;
    const record = await runInTenant(
      tenantId,
      async () =>
        await this.prisma.db.jobRecord.create({
          data: { tenantId, name, payload: stored },
        }),
    );
    await this.queue.enqueue(
      name,
      { tenantId, ...stored },
      { jobId: record.id },
    );
    return record.id;
  }

  async markDone(tenantId: string, id: string): Promise<void> {
    await runInTenant(tenantId, async () => {
      await this.prisma.db.jobRecord.update({
        where: { id },
        data: { status: 'DONE' },
      });
    });
  }

  async markFailed(tenantId: string, id: string, error: string): Promise<void> {
    await runInTenant(tenantId, async () => {
      await this.prisma.db.jobRecord.update({
        where: { id },
        data: {
          status: 'FAILED',
          lastError: error.slice(0, 2000),
          attempts: { increment: 1 },
        },
      });
    });
  }

  /** Cross-tenant by design: runs from the worker, not from a request. */
  async reconcile(
    staleAfterMs = 5 * 60_000,
    now = new Date(),
  ): Promise<number> {
    return await runAsSystem(async () => {
      const stale = await this.prisma.db.jobRecord.findMany({
        where: {
          status: 'PENDING',
          runAt: { lte: new Date(now.getTime() - staleAfterMs) },
        },
        take: 200,
      });
      for (const r of stale) {
        await this.queue.enqueue(
          r.name,
          { tenantId: r.tenantId, ...(r.payload as object) },
          { jobId: r.id },
        );
      }
      return stale.length;
    });
  }
}
