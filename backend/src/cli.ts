import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { QueueService } from './platform/queue/queue.service.js';

/**
 * Cron entry point: `node dist/cli.js worker --max-seconds=55`.
 * Handlers are registered per job name in later phases.
 */
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'worker') {
    console.error('Usage: cli.js worker [--max-seconds=55]');
    process.exit(1);
  }
  const maxSeconds = Number(
    args.find((a) => a.startsWith('--max-seconds='))?.split('=')[1] ?? 55,
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  await app.get(QueueService).runWorker(async (job) => {
    console.warn(`No handler registered for job "${job.name}"`);
  }, maxSeconds);
  await app.close();
}
await main();
