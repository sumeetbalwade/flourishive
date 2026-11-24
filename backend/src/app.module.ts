import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerParams } from './platform/http/logger.js';
import { CacheModule } from './platform/cache/cache.module.js';
import { ConfigModule } from './platform/config/config.module.js';
import { DesktopModule } from './modules/desktop/desktop.module.js';
import { VerifyModule } from './modules/verify/verify.module.js';
import { SigningModule } from './modules/signing/signing.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { OrgModule } from './modules/org/org.module.js';
import { PeopleModule } from './modules/people/people.module.js';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module.js';
import { BrandModule } from './modules/brand/brand.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { CompanyModule } from './modules/company/company.module.js';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { BillingOpsModule } from './modules/billing/billing-ops.module.js';
import { ControlsModule } from './modules/controls/controls.module.js';
import { DomainsModule } from './modules/domains/domains.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { LogsModule } from './modules/logs/logs.module.js';
import { MailAdminModule } from './modules/mail/mail-admin.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { CryptoModule } from './platform/crypto/crypto.module.js';
import { HealthController } from './platform/health/health.controller.js';
import { MailModule } from './platform/mail/mail.module.js';
import { QueueModule } from './platform/queue/queue.module.js';
import { StorageModule } from './platform/storage/storage.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams(process.env.NODE_ENV)),
    ConfigModule,
    CryptoModule,
    DatabaseModule,
    CacheModule,
    QueueModule,
    StorageModule,
    MailModule,
    IdentityModule,
    MailAdminModule,
    LogsModule,
    CompanyModule,
    DomainsModule,
    AccessModule,
    SettingsModule,
    AuditModule,
    FilesModule,
    BrandModule,
    NotificationsModule,
    PlatformAdminModule,
    OrgModule,
    PeopleModule,
    DocumentsModule,
    SigningModule,
    VerifyModule,
    DesktopModule,
    ControlsModule,
    BillingModule,
    BillingOpsModule,
    CustomFieldsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
