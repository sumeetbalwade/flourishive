import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
}

@Injectable()
export class GoogleService {
  private readonly client = new OAuth2Client();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Verifies a Google ID token (signature, audience, expiry) and a verified email. */
  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.config.GOOGLE_CLIENT_ID)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.GOOGLE_CLIENT_ID,
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
