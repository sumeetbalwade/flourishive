import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../identity/token.service.js';
import { PlatformAuthService } from './platform-auth.service.js';
import type { PlatformPermission } from './platform-permissions.js';
import { PlatformRolesService } from './platform-roles.service.js';

export type PlatformRequest = Request & {
  platformAuth?: {
    platformUserId: string;
    sessionId: string;
    permissions: ReadonlySet<string>;
  };
};

const REQUIRED = 'platformPermission';
/** The staff permission a console route needs. A route without it only needs a signed-in staff member. */
export const RequirePlatformPermission = (...codes: PlatformPermission[]) =>
  SetMetadata(REQUIRED, codes);

/**
 * Requires a valid, non-revoked staff access token (a tenant token is rejected by audience) and, where
 * the route names one, a role that holds the permission.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly auth: PlatformAuthService,
    private readonly roles: PlatformRolesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new UnauthorizedException();
    const claims = await this.tokens.verifyPlatformAccess(h.slice(7));
    if (await this.auth.isRevoked(claims.sessionId))
      throw new UnauthorizedException('Session ended');
    const permissions = await this.roles.permissionsOf(claims.platformUserId);
    req.platformAuth = { ...claims, permissions };
    const needed = this.reflector.getAllAndOverride<PlatformPermission[]>(
      REQUIRED,
      [context.getHandler(), context.getClass()],
    );
    // Holding any one of the listed codes is enough.
    if (needed?.length && !needed.some((c) => permissions.has(c)))
      throw new ForbiddenException('Your role does not allow this');
    return true;
  }
}
