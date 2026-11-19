import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from './permissions.js';

export const REQUIRED_PERMISSION = 'requiredPermission';
/** The caller must hold this permission (for any entity). Entity-specific checks use AccessService.can(). */
export const RequirePermission = (code: PermissionCode) =>
  SetMetadata(REQUIRED_PERMISSION, code);
