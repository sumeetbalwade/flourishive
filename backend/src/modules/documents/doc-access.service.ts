import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import type { PermissionCode } from '../access/permissions.js';

export interface Actor {
  tenantId: string;
  userId: string;
}

/** Roles can be limited to one company, so a document permission is always checked per company. */
@Injectable()
export class DocAccess {
  constructor(private readonly access: AccessService) {}

  async assert(a: Actor, code: PermissionCode, entityId: string) {
    if (!(await this.access.can(a.tenantId, a.userId, code, entityId)))
      throw new ForbiddenException('You do not have access to that company');
  }

  /** A where-clause limiting rows to the companies this user may see (empty for all). */
  async entityFilter(a: Actor, code: PermissionCode) {
    const scope = await this.access.entityScope(a.tenantId, a.userId, code);
    if (!scope) throw new ForbiddenException();
    return scope === '*' ? {} : { entityId: { in: scope } };
  }
}
