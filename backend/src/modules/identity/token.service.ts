import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';

export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
  /** Present when platform staff is looking at this company in a support session (D-56). */
  support?: { mode: 'READ' | 'WRITE' };
}

export type MfaChallengePurpose = 'mfa-verify' | 'mfa-setup';
export interface MfaChallengeClaims {
  userId: string;
  tenantId: string;
  purpose: MfaChallengePurpose;
}

const ISSUER = 'flourishive-api';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  private sign(
    claims: Record<string, unknown>,
    audience: string,
    ttlSeconds: number,
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  private async verify(
    token: string,
    audience: string,
  ): Promise<Record<string, unknown>> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience,
        algorithms: ['HS256'],
      });
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  signAccess(claims: AccessClaims, ttlSeconds?: number): Promise<string> {
    return this.sign(
      { ...claims, sub: claims.userId },
      'access',
      ttlSeconds ?? this.config.ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const p = await this.verify(token, 'access');
    return {
      userId: String(p.userId),
      tenantId: String(p.tenantId),
      sessionId: String(p.sessionId),
      ...(p.support
        ? { support: p.support as NonNullable<AccessClaims['support']> }
        : {}),
    };
  }

  /** Short-lived token proving the password step passed; only usable for the MFA endpoints. */
  signMfaChallenge(claims: MfaChallengeClaims): Promise<string> {
    return this.sign({ ...claims }, 'mfa', 300);
  }

  async verifyMfaChallenge(token: string): Promise<MfaChallengeClaims> {
    const p = await this.verify(token, 'mfa');
    return {
      userId: String(p.userId),
      tenantId: String(p.tenantId),
      purpose: p.purpose as MfaChallengePurpose,
    };
  }

  /** Super admin tokens use their own audiences, so they can never be used on tenant routes (or vice versa). */
  signPlatformAccess(claims: {
    platformUserId: string;
    sessionId: string;
  }): Promise<string> {
    return this.sign(
      { ...claims, sub: claims.platformUserId },
      'platform',
      this.config.ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  async verifyPlatformAccess(
    token: string,
  ): Promise<{ platformUserId: string; sessionId: string }> {
    const p = await this.verify(token, 'platform');
    return {
      platformUserId: String(p.platformUserId),
      sessionId: String(p.sessionId),
    };
  }

  signPlatformMfa(claims: {
    platformUserId: string;
    purpose: MfaChallengePurpose;
  }): Promise<string> {
    return this.sign({ ...claims }, 'platform-mfa', 300);
  }

  async verifyPlatformMfa(
    token: string,
  ): Promise<{ platformUserId: string; purpose: MfaChallengePurpose }> {
    const p = await this.verify(token, 'platform-mfa');
    return {
      platformUserId: String(p.platformUserId),
      purpose: p.purpose as MfaChallengePurpose,
    };
  }

  /** Opaque refresh token: the client keeps `token`, the database keeps only `hash`. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }
}
