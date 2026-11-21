import { corsOrigins, loadConfig } from './config.js';

const required = {
  DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/x',
  FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
  HMAC_SECRET: 'h'.repeat(32),
  JWT_SECRET: 'j'.repeat(32),
};

describe('product name and domain', () => {
  it('defaults to local development addresses', () => {
    const c = loadConfig({ ...required });
    expect(c.APP_NAME).toBe('Flourishive');
    expect(c.TENANT_URL_TEMPLATE).toBe('http://{slug}.localhost:5173');
    expect(c.WEB_URL).toBe('http://localhost:5173');
    expect(c.ADMIN_URL).toBe('http://localhost:5174');
    expect(c.MAIL_FROM).toBe('Flourishive <no-reply@localhost>');
    expect(c.CORS_ORIGINS).toContain('http://*.localhost:5173');
  });

  it('builds every address from the name and domain', () => {
    const c = loadConfig({
      ...required,
      APP_NAME: 'Acme HR',
      APP_DOMAIN: 'AcmeHR.com',
    });
    expect(c.TENANT_URL_TEMPLATE).toBe('https://{slug}.acmehr.com');
    expect(c.WEB_URL).toBe('https://app.acmehr.com');
    expect(c.ADMIN_URL).toBe('https://admin.acmehr.com');
    expect(c.MAIL_FROM).toBe('Acme HR <no-reply@acmehr.com>');
    expect(c.CORS_ORIGINS).toBe(
      'https://app.acmehr.com,https://admin.acmehr.com,https://verify.acmehr.com,https://*.acmehr.com',
    );
  });

  it('lets an explicit setting win over the derived one', () => {
    const c = loadConfig({
      ...required,
      APP_DOMAIN: 'acmehr.com',
      WEB_URL: 'https://hr.example.org',
      MAIL_FROM: 'HR <hr@example.org>',
      CORS_ORIGINS: 'https://hr.example.org',
    });
    expect(c.WEB_URL).toBe('https://hr.example.org');
    expect(c.MAIL_FROM).toBe('HR <hr@example.org>');
    expect(c.CORS_ORIGINS).toBe('https://hr.example.org');
    expect(c.TENANT_URL_TEMPLATE).toBe('https://{slug}.acmehr.com');
  });

  it('refuses something that is not a domain', () => {
    expect(() =>
      loadConfig({ ...required, APP_DOMAIN: 'https://x.com/' }),
    ).toThrow(/APP_DOMAIN/);
  });

  it('derives browser origins without a full config', () => {
    expect(corsOrigins(undefined, 'acmehr.com')).toContain(
      'https://*.acmehr.com',
    );
    expect(corsOrigins('', 'acmehr.com')).toBe('');
  });
});
