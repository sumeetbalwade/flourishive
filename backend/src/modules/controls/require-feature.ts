import type { FeatureKey } from '@flourishive/schemas';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../identity/auth.context.js';
import { FeaturesService } from './features.service.js';

const REQUIRED_FEATURE = 'requiredFeature';
/** The route (or every route of the class) works only while this module is switched on for the company. */
export const RequireFeature = (feature: FeatureKey) =>
  SetMetadata(REQUIRED_FEATURE, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRED_FEATURE,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    // Open routes carry no company; they check inside their service.
    if (!auth) return true;
    await this.features.assert(auth.tenantId, feature);
    return true;
  }
}
