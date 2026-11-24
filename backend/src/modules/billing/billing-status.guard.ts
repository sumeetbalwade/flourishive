import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { AuthedRequest } from '../identity/auth.context.js';
import { LimitsService } from './limits.service.js';

/** Routes that must keep working so a read-only company can sign in and pay. */
const ALWAYS = [/\/billing\//, /\/auth\//, /\/webhooks\//];

/**
 * A company whose payment is long overdue can look but not change anything (D-21). Reads, signing in
 * and the billing screens stay open, so paying is always possible.
 */
@Injectable()
export class BillingStatusGuard implements CanActivate {
  constructor(private readonly limits: LimitsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth || ['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      return true;
    if (ALWAYS.some((r) => r.test(req.originalUrl ?? req.url))) return true;
    const { status } = await this.limits.resolve(req.auth.tenantId);
    if (status !== 'READ_ONLY') return true;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'READ_ONLY',
        message:
          'Your account is read-only because a payment is overdue. Pay on the Plan page to switch editing back on.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
