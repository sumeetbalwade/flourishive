import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../identity/token.service.js';
import { PlatformAuthService } from './platform-auth.service.js';

export type PlatformRequest = Request & {
  platformAuth?: { platformUserId: string; sessionId: string };
};

/** Requires a valid, non-revoked super admin access token (a tenant token is rejected by audience). */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly auth: PlatformAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new UnauthorizedException();
    const claims = await this.tokens.verifyPlatformAccess(h.slice(7));
    if (await this.auth.isRevoked(claims.sessionId))
      throw new UnauthorizedException('Session ended');
    req.platformAuth = claims;
    return true;
  }
}
