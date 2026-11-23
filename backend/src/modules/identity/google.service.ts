import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
}

@Injectable()
export class GoogleService {
  private readonly client = new OAuth2Client();

  constructor(private readonly runtime: RuntimeConfigService) {}

  /** Verifies a Google ID token (signature, audience, expiry) and a verified email. */
  async verify(idToken: string): Promise<GoogleIdentity> {
    const audience = await this.runtime.get('GOOGLE_CLIENT_ID');
    if (!audience)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience,
      });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email || !p.email_verified)
        throw new Error('unverified');
      return { sub: p.sub, email: p.email.toLowerCase() };
    } catch {
      throw new UnauthorizedException('Google sign-in failed');
    }
  }
}
