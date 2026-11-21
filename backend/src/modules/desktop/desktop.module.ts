import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { SigningModule } from '../signing/signing.module.js';
import {
  DesktopJobsController,
  DesktopPairController,
  DesktopStaffController,
} from './desktop.controller.js';
import { DeviceGuard } from './device.guard.js';
import { DeviceService } from './device.service.js';

@Module({
  imports: [AccessModule, SigningModule],
  controllers: [
    DesktopStaffController,
    DesktopPairController,
    DesktopJobsController,
  ],
  providers: [DeviceService, DeviceGuard],
})
export class DesktopModule {}
