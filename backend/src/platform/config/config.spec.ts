import { loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db',
  FIELD_ENCRYPTION_KEY: 'a'.repeat(64),
  HMAC_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults to a minimal valid environment', () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.SMTP_SECURE).toBe(false);
  });

  it('fails fast and names every bad variable', () => {
    expect(() => loadConfig({ FIELD_ENCRYPTION_KEY: 'short' })).toThrow(
      /DATABASE_URL[\s\S]*FIELD_ENCRYPTION_KEY|FIELD_ENCRYPTION_KEY[\s\S]*DATABASE_URL/,
    );
  });
});
