import { Module } from '@nestjs/common';
import { CacheModule } from './platform/cache/cache.module.js';
import { ConfigModule } from './platform/config/config.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { CryptoModule } from './platform/crypto/crypto.module.js';
import { HealthController } from './platform/health/health.controller.js';
import { MailModule } from './platform/mail/mail.module.js';
import { QueueModule } from './platform/queue/queue.module.js';
import { StorageModule } from './platform/storage/storage.module.js';

@Module({
  imports: [
    ConfigModule,
    CryptoModule,
    DatabaseModule,
    CacheModule,
    QueueModule,
    StorageModule,
    MailModule,
    IdentityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
