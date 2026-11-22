import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { StorageMigrateService } from './modules/files/storage-migrate.service.js';
import { StorageService } from './platform/storage/storage.service.js';
import { AccessService } from './modules/access/access.service.js';
import { AuditWatchService } from './modules/platform-admin/audit-watch.service.js';
import { PlatformAuthService } from './modules/platform-admin/platform-auth.service.js';
import { JobHandlerRegistry } from './platform/queue/job-handlers.js';
import { JobRecordsService } from './platform/queue/job-records.service.js';
import { QueueService } from './platform/queue/queue.service.js';

/**
 * Command line entry point (run by cron or by an operator over SSH):
 *   node dist/cli.js worker [--max-seconds=55]
 *   node dist/cli.js create-platform-user --email=you@example.com
 *   node dist/cli.js storage-check           (is file storage working, and how many reads fell back to local disk)
 *   node dist/cli.js sync-roles              (after a deploy: gives every company's system roles any new permissions)
 *   node dist/cli.js storage-migrate-r2 [--dry-run] [--delete-local]
 *   node dist/cli.js verify-audit            (nightly cron: re-checks every audit hash chain)
 */
const arg = (args: string[], name: string) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (
    command !== 'worker' &&
    command !== 'create-platform-user' &&
    command !== 'verify-audit' &&
    command !== 'storage-migrate-r2' &&
    command !== 'sync-roles' &&
    command !== 'storage-check'
  ) {
    console.error(
      'Usage: cli.js worker [--max-seconds=55] | create-platform-user --email=<address> | verify-audit | storage-migrate-r2 [--dry-run] [--delete-local] | sync-roles | storage-check',
    );
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  if (command === 'storage-check') {
    const r = await app.get(StorageService).check();
    console.log(
      `${r.driver} storage: ${r.ok ? 'OK' : `FAILED (${r.error})`} in ${r.latencyMs} ms; reads that used local disk: ${r.fallbackReads}`,
    );
    await app.close();
    process.exit(r.ok ? 0 : 2);
  }

  if (command === 'sync-roles') {
    const n = await app.get(AccessService).provisionAllTenants();
    console.log(`Synced system roles for ${n} compan${n === 1 ? 'y' : 'ies'}`);
    await app.close();
    return;
  }

  if (command === 'storage-migrate-r2') {
    const r = await app.get(StorageMigrateService).run({
      dryRun: args.includes('--dry-run'),
      deleteLocal: args.includes('--delete-local'),
    });
    const dry = args.includes('--dry-run') ? ' (dry run, nothing written)' : '';
    console.log(
      `Copied ${r.copied}, already in R2 ${r.alreadyPresent}, missing locally ${r.missingLocally.length}, checksum mismatches ${r.mismatched.length}, local copies deleted ${r.deletedLocal}${dry}`,
    );
    for (const k of r.mismatched) console.error(`  MISMATCH ${k}`);
    for (const k of r.missingLocally) console.error(`  MISSING ${k}`);
    await app.close();
    process.exit(r.mismatched.length === 0 ? 0 : 2);
  }

  if (command === 'verify-audit') {
    const r = await app.get(AuditWatchService).run();
    console.log(
      `Checked ${r.rowsChecked} audit rows across ${r.tenants} compan${r.tenants === 1 ? 'y' : 'ies'}: ${
        r.broken.length === 0
          ? 'all chains intact'
          : `${r.broken.length} BROKEN`
      }`,
    );
    for (const b of r.broken) console.error(`  ${b.slug}: ${b.reason}`);
    await app.close();
    // A non-zero exit lets cron report the failure as well as the email.
    process.exit(r.broken.length === 0 ? 0 : 2);
  }

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
