import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessModule } from '../access/access.module.js';
import { PermissionGuard } from '../access/permission.guard.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AuditInterceptor } from '../audit/audit.interceptor.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { GoogleService } from './google.service.js';
import { MfaService } from './mfa.service.js';
import { OtpService } from './otp.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { PasswordService } from './password.service.js';
import { StepUpGuard, StepUpService } from './step-up.service.js';
import { PasskeyService } from './passkey.service.js';
import { TrustedDeviceService } from './trusted-device.service.js';
import { AccountActionsService } from './account-actions.service.js';
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
    OtpService,
    PasswordService,
    PasswordPolicyService,
    SessionService,
    TrustedDeviceService,
    PasskeyService,
    AccountActionsService,
    StepUpService,
    StepUpGuard,
    ThrottleService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
    // Must come after AuthGuard: it reads the signed-in user from the request.
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    MfaService,
    OtpService,
    TrustedDeviceService,
    PasskeyService,
    AccountActionsService,
    StepUpService,
    StepUpGuard,
    ThrottleService,
  ],
})
export class IdentityModule {}
