import { loadConfig } from '../config/config.js';
import { CryptoService } from './crypto.service.js';

const crypto = new CryptoService(
  loadConfig({
    DATABASE_URL: 'x',
    FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
    HMAC_SECRET: 'x'.repeat(32),
  }),
);

describe('CryptoService', () => {
  it('round-trips encrypted fields with a fresh IV each time', () => {
    const a = crypto.encrypt('PAN ABCDE1234F');
    expect(a).not.toContain('ABCDE');
    expect(crypto.decrypt(a)).toBe('PAN ABCDE1234F');
    expect(crypto.encrypt('PAN ABCDE1234F')).not.toBe(a);
  });

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, data] = crypto.encrypt('secret').split(':');
    const flipped = `${data!.slice(0, -1)}${data!.endsWith('A') ? 'B' : 'A'}`;
    expect(() => crypto.decrypt([v, iv, tag, flipped].join(':'))).toThrow();
  });

  it('verifies HMACs', () => {
    expect(crypto.verifyHmac('m', crypto.hmac('m'))).toBe(true);
    expect(crypto.verifyHmac('m2', crypto.hmac('m'))).toBe(false);
    expect(crypto.verifyHmac('m', 'zz')).toBe(false);
  });
});
