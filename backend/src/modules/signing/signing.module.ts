import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { FilesModule } from '../files/files.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { SealService } from './seal/seal.service.js';
import {
  AcceptanceController,
  SigningStaffController,
} from './signing.controller.js';
import { SigningService } from './signing.service.js';

@Module({
  imports: [
    AccessModule,
    FilesModule,
    IdentityModule,
    SettingsModule,
    WorkflowModule,
  ],
  controllers: [SigningStaffController, AcceptanceController],
  providers: [SigningService, SealService],
  exports: [SigningService, SealService],
})
export class SigningModule {}
