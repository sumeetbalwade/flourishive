import { Global, Module } from '@nestjs/common';
import { JobHandlerRegistry } from './job-handlers.js';
import { JobRecordsService } from './job-records.service.js';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  providers: [QueueService, JobRecordsService, JobHandlerRegistry],
  exports: [QueueService, JobRecordsService, JobHandlerRegistry],
})
export class QueueModule {}
