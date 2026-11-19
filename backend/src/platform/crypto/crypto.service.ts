import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** AES-256-GCM field encryption (v1:iv:tag:ciphertext, base64url) and HMAC helpers. */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.FIELD_ENCRYPTION_KEY, 'hex');
    this.hmacKey = Buffer.from(config.HMAC_SECRET, 'utf8');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !data)
      throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  hmac(message: string): string {
    return createHmac('sha256', this.hmacKey).update(message).digest('hex');
  }

  verifyHmac(message: string, signature: string): boolean {
    const expected = Buffer.from(this.hmac(message), 'hex');
    const given = Buffer.from(signature, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
