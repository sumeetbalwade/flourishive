import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationsController } from './notifications.controller.js';
import { EmailTemplatesService } from './email-templates.service.js';
import { NotificationRulesController } from './notification-rules.controller.js';
import { RemindersService } from './reminders.service.js';
import { NotificationRulesService } from './notification-rules.service.js';
import { NotificationsService } from './notifications.service.js';

@Global()
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController, NotificationRulesController],
  providers: [
    NotificationsService,
    EmailTemplatesService,
    NotificationRulesService,
    RemindersService,
  ],
  exports: [
    NotificationsService,
    EmailTemplatesService,
    NotificationRulesService,
    RemindersService,
  ],
})
export class NotificationsModule {}
