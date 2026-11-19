import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { runInTenant } from '../database/tenant-context.js';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * Modules register a handler per job name; the cron-started worker dispatches to it
 * inside the job's tenant scope. A job with no handler fails loudly so it is retried
 * (and visible), instead of silently disappearing.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly log = new Logger(JobHandlerRegistry.name);
  private readonly handlers = new Map<string, JobHandler>();

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async dispatch(job: Pick<Job, 'name' | 'data'>): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler)
      throw new Error(`No handler registered for job "${job.name}"`);
    const payload = (job.data ?? {}) as Record<string, unknown>;
    const tenantId =
      typeof payload.tenantId === 'string' ? payload.tenantId : undefined;
    if (!tenantId) throw new Error(`Job "${job.name}" has no tenantId`);
    this.log.debug(`running ${job.name} for tenant ${tenantId}`);
    await runInTenant(tenantId, async () => await handler(payload));
  }
}
