import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { ThrottleService } from './throttle.service.js';

/** How long a confirmed step-up stays valid for its session. */
export const STEP_UP_SECONDS = 5 * 60;

interface Credentials {
  passwordHash: string | null;
  mfaSecretEnc: string | null;
  mfaEnabled: boolean;
}

/**
 * "Confirm it is you" before a sensitive action (secrets, roles, account actions). A person with
 * two-step confirms with a code; a person without it confirms with their password. The confirmation
 * belongs to the session and lasts five minutes.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly throttle: ThrottleService,
  ) {}

  async isFresh(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(`stepup:${sessionId}`)) === 1;
  }

  private async mark(sessionId: string) {
    await this.redis.client.set(
      `stepup:${sessionId}`,
      '1',
      'EX',
      STEP_UP_SECONDS,
    );
  }

  async confirmTenant(
    c: { tenantId: string; userId: string; sessionId: string },
    input: { code?: string; password?: string },
  ): Promise<void> {
    const user = await runInTenant(
      c.tenantId,
      async () =>
        await this.prisma.db.user.findUnique({ where: { id: c.userId } }),
    );
    await this.confirm(
      `user:${c.userId}`,
      c.sessionId,
      input,
      user && {
        passwordHash: user.passwordHash,
        mfaSecretEnc: user.mfaSecretEnc,
        mfaEnabled: Boolean(user.mfaEnabledAt),
      },
    );
  }

  async confirmPlatform(
    c: { platformUserId: string; sessionId: string },
    input: { code?: string; password?: string },
  ): Promise<void> {
    const user = await runAsSystem(
      async () =>
        await this.prisma.db.platformUser.findUnique({
          where: { id: c.platformUserId },
        }),
    );
    await this.confirm(
      `platform:user:${c.platformUserId}`,
      c.sessionId,
      input,
      user && {
        passwordHash: user.passwordHash,
        mfaSecretEnc: user.mfaSecretEnc,
        mfaEnabled: Boolean(user.mfaEnabledAt),
      },
    );
  }

  private async confirm(
    throttleKey: string,
    sessionId: string,
    input: { code?: string; password?: string },
    creds: Credentials | null,
  ): Promise<void> {
    const key = `stepup:${throttleKey}`;
    await this.throttle.assertNotLocked('mfa', key);
    let ok = false;
    if (creds?.mfaEnabled && creds.mfaSecretEnc) {
      if (
        input.code &&
        (await this.mfa.verifyCode(creds.mfaSecretEnc, input.code))
      )
        // A code works once, so a shoulder-surfed code cannot be replayed.
        ok =
          (await this.redis.client.set(
            `totp:used:stepup:${throttleKey}:${input.code}`,
            '1',
            'EX',
            120,
            'NX',
          )) === 'OK';
    } else if (creds?.passwordHash && input.password) {
      ok = await this.passwords.verify(input.password, creds.passwordHash);
    }
    if (!ok) {
      await this.throttle.recordFailure('mfa', key);
      throw new UnauthorizedException('That did not match. Try again.');
    }
    await this.throttle.clear('mfa', key);
    await this.mark(sessionId);
  }
}

type AnyRequest = Request & {
  auth?: { sessionId: string };
  platformAuth?: { sessionId: string };
};

/** Runs after the sign-in guards, so the session is already on the request. */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly stepUp: StepUpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AnyRequest>();
    const sessionId = req.auth?.sessionId ?? req.platformAuth?.sessionId;
    if (!sessionId) throw new UnauthorizedException();
    if (!(await this.stepUp.isFresh(sessionId)))
      throw new ForbiddenException({
        statusCode: 403,
        code: 'STEP_UP_REQUIRED',
        message: 'Confirm it is you to continue',
      });
    return true;
  }
}

/** Put on a route that needs a recent confirmation (see StepUpService). */
export const RequireStepUp = () =>
  applyDecorators(SetMetadata('requireStepUp', true), UseGuards(StepUpGuard));
