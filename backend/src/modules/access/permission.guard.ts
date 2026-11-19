import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../identity/auth.context.js';
import { AccessService } from './access.service.js';
import type { PermissionCode } from './permissions.js';
import { REQUIRED_PERMISSION } from './require-permission.js';

/** Runs after AuthGuard. Routes without @RequirePermission only need a signed-in user. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      PermissionCode | undefined
    >(REQUIRED_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw new UnauthorizedException();
    // Holding it for any company is enough here; services check the specific company.
    const scope = await this.access.entityScope(
      auth.tenantId,
      auth.userId,
      required,
    );
    if (scope === null) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
