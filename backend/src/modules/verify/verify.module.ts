import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { SigningModule } from '../signing/signing.module.js';
import { VerifyController } from './verify.controller.js';
import { VerifyService } from './verify.service.js';

@Module({
  imports: [FilesModule, SigningModule],
  controllers: [VerifyController],
  providers: [VerifyService],
})
export class VerifyModule {}
