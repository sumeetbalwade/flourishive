import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AlertsService } from './alerts.service.js';
import { ErrorLogService } from './error-log.service.js';
import { LogWriterService } from './log-writer.service.js';
import { AlertsController, LogsController } from './logs.controller.js';
import { LogsService } from './logs.service.js';

/** Logs, error tracking and alerts (D-67, D-68). Global so any module can note a sign-in or an error. */
@Global()
@Module({
  imports: [SettingsModule],
  controllers: [LogsController, AlertsController],
  providers: [LogWriterService, ErrorLogService, LogsService, AlertsService],
  exports: [LogWriterService, ErrorLogService, LogsService, AlertsService],
})
export class LogsModule {}
