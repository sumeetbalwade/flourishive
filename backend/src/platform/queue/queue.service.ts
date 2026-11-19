import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export const DEFAULT_QUEUE = 'default';

/** BullMQ on Redis (D-30). The API enqueues; a cron-started worker processes. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    this.connection = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(
    name: string,
    data: unknown,
    options: { jobId?: string; delayMs?: number } = {},
  ): Promise<void> {
    await this.queue(DEFAULT_QUEUE).add(name, data, {
      jobId: options.jobId,
      delay: options.delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Runs a worker for at most `maxSeconds`, then drains and exits (cron model). */
  async runWorker(processor: Processor, maxSeconds: number): Promise<void> {
    const worker = new Worker(DEFAULT_QUEUE, processor, {
      connection: new Redis(this.config.REDIS_URL, {
        maxRetriesPerRequest: null,
      }),
      concurrency: 2,
    });
    await new Promise((r) => setTimeout(r, maxSeconds * 1000));
    await worker.close();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.connection.disconnect();
  }
}
