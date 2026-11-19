import { Inject, Injectable } from '@nestjs/common';
import { generate, generateSecret, generateURI, verify } from 'otplib';
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../../platform/crypto/crypto.service.js';
import { sha256 } from './token.service.js';

@Injectable()
export class MfaService {
  constructor(@Inject(CryptoService) private readonly crypto: CryptoService) {}

  newSecret(): string {
    return generateSecret();
  }

  encryptSecret(secret: string): string {
    return this.crypto.encrypt(secret);
  }

  otpauthUri(secret: string, email: string): string {
    return generateURI({ issuer: 'Flourishive', label: email, secret });
  }

  /** One step either side of now tolerates small clock drift. */
  async verifyCode(encryptedSecret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const secret = this.crypto.decrypt(encryptedSecret);
    const result = await verify({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  }

  /** Test helper and tool for the seed script. */
  currentCode(encryptedSecret: string): Promise<string> {
    return generate({ secret: this.crypto.decrypt(encryptedSecret) });
  }

  /** Ten single-use codes, shown once. Returns plaintext and hashes. */
  newRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: count }, () => {
      const raw = randomBytes(5).toString('hex'); // 10 hex chars
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    return { codes, hashes: codes.map(hashRecoveryCode) };
  }
}

export function hashRecoveryCode(code: string): string {
  return sha256(code.trim().toLowerCase());
}
