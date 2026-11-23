import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationsController } from './notifications.controller.js';
import { EmailTemplatesService } from './email-templates.service.js';
import { NotificationsService } from './notifications.service.js';

@Global()
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailTemplatesService],
  exports: [NotificationsService, EmailTemplatesService],
})
export class NotificationsModule {}
