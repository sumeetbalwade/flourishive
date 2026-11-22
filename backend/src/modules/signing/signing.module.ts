import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { FilesModule } from '../files/files.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { EsignGateway } from './esign/gateway.js';
import { MockEsignController } from './esign/mock.controller.js';
import { SealService } from './seal/seal.service.js';
import {
  AcceptanceController,
  SigningStaffController,
} from './signing.controller.js';
import { DscJobsService } from './dsc-jobs.service.js';
import {
  DscValidator,
  OcspRevocationChecker,
  RevocationChecker,
} from './dsc/dsc-validator.js';
import { SigningService } from './signing.service.js';

@Module({
  imports: [
    AccessModule,
    FilesModule,
    IdentityModule,
    SettingsModule,
    WorkflowModule,
  ],
  controllers: [
    SigningStaffController,
    AcceptanceController,
    MockEsignController,
  ],
  providers: [
    SigningService,
    EsignGateway,
    SealService,
    DscJobsService,
    DscValidator,
    { provide: RevocationChecker, useClass: OcspRevocationChecker },
  ],
  exports: [SigningService, SealService, DscJobsService],
})
export class SigningModule {}
