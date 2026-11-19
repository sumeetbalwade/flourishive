import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';

@Module({
  imports: [IdentityModule, SettingsModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
