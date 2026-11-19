import { Module } from '@nestjs/common';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { RolePolicyService } from './role-policy.service.js';
import { PermissionGuard } from './permission.guard.js';

@Module({
  controllers: [AccessController],
  providers: [AccessService, RolePolicyService, PermissionGuard],
  exports: [AccessService, RolePolicyService, PermissionGuard],
})
export class AccessModule {}
