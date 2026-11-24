import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { MailController } from './mail.controller.js';
import { MailTemplatesController } from './mail-templates.controller.js';
import { MailDeliveriesService } from './mail-deliveries.service.js';
import { MailSenderService } from './mail-sender.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [MailController, MailTemplatesController],
  providers: [MailSenderService, MailDeliveriesService],
  exports: [MailSenderService, MailDeliveriesService],
})
export class MailAdminModule {}
