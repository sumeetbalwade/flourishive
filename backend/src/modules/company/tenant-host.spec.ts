import { originMatcher, slugFromOrigin, tenantUrl } from './tenant-host.js';

const T = 'https://{slug}.flourishive.in';

describe('tenant addresses', () => {
  it('builds a company address from the template', () => {
    expect(tenantUrl(T, 'acme')).toBe('https://acme.flourishive.in');
  });

  it('reads the company out of an origin', () => {
    expect(slugFromOrigin(T, 'https://acme.flourishive.in')).toBe('acme');
    expect(
      slugFromOrigin(T, 'https://acme.flourishive.in.evil.com'),
    ).toBeNull();
    expect(slugFromOrigin(T, 'http://acme.flourishive.in')).toBeNull();
    expect(slugFromOrigin(T, 'https://a.b.flourishive.in')).toBeNull();
    expect(slugFromOrigin(T, undefined)).toBeNull();
    expect(
      slugFromOrigin(
        'http://{slug}.localhost:5173',
        'http://acme.localhost:5173',
      ),
    ).toBe('acme');
  });

  it('matches wildcard CORS origins one label deep only', () => {
    const ok = originMatcher([
      'https://*.flourishive.in',
      'https://app.example.com',
    ]);
    expect(ok('https://acme.flourishive.in')).toBe(true);
    expect(ok('https://app.example.com')).toBe(true);
    expect(ok('https://a.b.flourishive.in')).toBe(false);
    expect(ok('https://flourishive.in')).toBe(false);
    expect(ok('https://evil.com')).toBe(false);
    expect(ok('https://acmeXflourishive.in')).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});
