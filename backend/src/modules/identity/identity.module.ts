import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessModule } from '../access/access.module.js';
import { PermissionGuard } from '../access/permission.guard.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { GoogleService } from './google.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TenantInterceptor } from './tenant.interceptor.js';
import { ThrottleService } from './throttle.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [AccessModule, SettingsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleService,
    MfaService,
    PasswordService,
    SessionService,
    ThrottleService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
    // Must come after AuthGuard: it reads the signed-in user from the request.
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
  exports: [AuthService, PasswordService, TokenService, SessionService],
})
export class IdentityModule {}
