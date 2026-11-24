import { Global, Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ApiClientGuard } from './api-client.guard.js';
import { ApiClientsController } from './api-clients.controller.js';
import { ApiClientsService } from './api-clients.service.js';
import { IdempotencyService } from './idempotency.service.js';
import {
  OAuthController,
  PublicApiController,
} from './public-api.controller.js';

/** The public API: OAuth clients, scoped tokens, rate limits and idempotent creates (D-20). */
@Global()
@Module({
  imports: [DocumentsModule, IdentityModule],
  controllers: [
    WebhooksController,
    ApiClientsController,
    OAuthController,
    PublicApiController,
  ],
  providers: [
    WebhooksService,
    ApiClientsService,
    ApiClientGuard,
    IdempotencyService,
  ],
  exports: [ApiClientsService, WebhooksService],
})
export class IntegrationsModule {}
