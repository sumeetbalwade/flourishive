import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runInTenant } from '../../platform/database/tenant-context.js';
import type { AuthedRequest } from './auth.context.js';

/**
 * Runs the rest of an authenticated request inside the caller's tenant scope, so
 * every query made while handling it is restricted to that tenant.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenantId = context.switchToHttp().getRequest<AuthedRequest>()
      .auth?.tenantId;
    if (!tenantId) return next.handle();
    return new Observable((subscriber) =>
      runInTenant(tenantId, () => next.handle().subscribe(subscriber)),
    );
  }
}
