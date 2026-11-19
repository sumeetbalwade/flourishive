import { Global, Module } from '@nestjs/common';
import { JobRecordsService } from './job-records.service.js';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  providers: [QueueService, JobRecordsService],
  exports: [QueueService, JobRecordsService],
})
export class QueueModule {}
