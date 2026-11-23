import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../platform/cache/redis.service.js';
import { IS_PUBLIC, type AuthedRequest } from './auth.context.js';
import { supportSessionKey } from './support-keys.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/** Global guard: every route needs a valid, non-revoked access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    const claims = await this.tokens.verifyAccess(header.slice(7));
    if (claims.support) {
      // Platform staff in a support session: valid only while the session is open (it can be ended
      // at any time), and a view-only session never changes anything.
      const open = await this.redis.getJson<{ tenantId: string }>(
        supportSessionKey(claims.sessionId),
      );
      if (!open || open.tenantId !== claims.tenantId)
        throw new UnauthorizedException('The support session has ended');
      // The one change a view-only session may make is ending itself.
      const endingItself =
        req.method === 'POST' &&
        req.path.endsWith('/support/sessions/current/end');
      if (
        claims.support.mode === 'READ' &&
        !endingItself &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      )
        throw new ForbiddenException(
          'This support session is view-only, so it cannot change anything',
        );
      req.auth = claims;
      return true;
    }
    if (await this.sessions.isRevoked(claims.sessionId))
      throw new UnauthorizedException('Session ended');
    if (await this.sessions.isTenantSuspended(claims.tenantId))
      throw new ForbiddenException('This account is suspended');
    req.auth = claims;
    return true;
  }
}
