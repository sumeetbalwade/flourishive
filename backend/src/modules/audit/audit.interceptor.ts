import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import type { AuthedRequest } from '../identity/auth.context.js';
import { AuditService } from './audit.service.js';

export type AuditableRequest = AuthedRequest & { auditSkip?: boolean };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every successful change made by a signed-in user, automatically, so a new
 * endpoint cannot forget to be audited. Reads are not recorded. Request bodies are
 * deliberately never stored; handlers that need more detail call AuditService directly.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditableRequest>();
    return next.handle().pipe(
      mergeMap(async (value) => {
        const auth = req.auth;
        if (auth && MUTATING.has(req.method) && !req.auditSkip) {
          const template = String(req.route?.path ?? req.path);
          const segments = template
            .replace(/^\/v\d+\//, '/')
            .split('/')
            .filter(Boolean);
          const params = req.params as Record<string, string>;
          await this.audit.recordSafely({
            tenantId: auth.tenantId,
            actorType: 'USER',
            actorId: auth.userId,
            action: `${req.method} ${template}`,
            entityType: segments[0] ?? null,
            entityId: params.id ?? params.entityId ?? null,
            meta: {
              status: context
                .switchToHttp()
                .getResponse<{ statusCode: number }>().statusCode,
            },
            ip: req.ip,
          });
        }
        return value;
      }),
    );
  }
}
