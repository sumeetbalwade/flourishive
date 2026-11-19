import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PlatformAuthService } from './modules/platform-admin/platform-auth.service.js';
import { JobHandlerRegistry } from './platform/queue/job-handlers.js';
import { JobRecordsService } from './platform/queue/job-records.service.js';
import { QueueService } from './platform/queue/queue.service.js';

/**
 * Command line entry point (run by cron or by an operator over SSH):
 *   node dist/cli.js worker [--max-seconds=55]
 *   node dist/cli.js create-platform-user --email=you@example.com
 */
const arg = (args: string[], name: string) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'worker' && command !== 'create-platform-user') {
    console.error(
      'Usage: cli.js worker [--max-seconds=55] | create-platform-user --email=<address>',
    );
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  if (command === 'create-platform-user') {
    const email = arg(args, 'email');
    if (!email) {
      console.error('--email is required');
      process.exit(1);
    }
    const invite = await app.get(PlatformAuthService).invite(email, null);
    console.log(
      `Invited ${email}. They choose a password and set up MFA at this link (valid 7 days):\n${invite.link}`,
    );
    if (!invite.emailed)
      console.log(
        '(The email could not be sent; give them the link directly.)',
      );
    await app.close();
    return;
  }

  const maxSeconds = Number(arg(args, 'max-seconds') ?? 55);
  const requeued = await app.get(JobRecordsService).reconcile();
  if (requeued > 0)
    console.warn(`Re-queued ${requeued} stale job(s) from job_records`);
  const handlers = app.get(JobHandlerRegistry);
  const jobRecords = app.get(JobRecordsService);
  await app.get(QueueService).runWorker(async (job) => {
    await handlers.dispatch(job);
    // Jobs created through job_records are marked done once their handler succeeds.
    const tenantId = (job.data as { tenantId?: string }).tenantId;
    if (job.id && tenantId)
      await jobRecords.markDone(tenantId, job.id).catch(() => undefined);
  }, maxSeconds);
  await app.close();
}
await main();
