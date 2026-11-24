import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import {
  DomainsController,
  DomainsPublicController,
} from './domains.controller.js';
import { DomainsService } from './domains.service.js';

/** Companies' own web addresses (D-69). Global so sign-in and email links can ask for the right address. */
@Global()
@Module({
  imports: [SettingsModule],
  controllers: [DomainsController, DomainsPublicController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
