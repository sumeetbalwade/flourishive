import { cloudflareMatcher, visitorIp } from './cloudflare.js';

const isCf = cloudflareMatcher();

describe('cloudflare addresses', () => {
  it('recognises Cloudflare edge addresses, v4 and v6, and nothing else', () => {
    expect(isCf('104.16.0.1')).toBe(true);
    expect(isCf('172.71.12.9')).toBe(true);
    expect(isCf('2606:4700:10::1')).toBe(true);
    expect(isCf('::ffff:162.158.1.1')).toBe(true);
    expect(isCf('203.0.113.7')).toBe(false);
    expect(isCf('127.0.0.1')).toBe(false);
    expect(isCf('2001:db8::1')).toBe(false);
    expect(isCf(undefined)).toBe(false);
    expect(isCf('not an ip')).toBe(false);
  });

  it('takes the visitor address from CF-Connecting-IP only when the peer is Cloudflare', () => {
    expect(visitorIp('104.16.0.1', '198.51.100.9', isCf)).toBe('198.51.100.9');
    expect(visitorIp('104.16.0.1', ['198.51.100.9'], isCf)).toBe(
      '198.51.100.9',
    );
    expect(visitorIp('104.16.0.1', '2001:db8::5', isCf)).toBe('2001:db8::5');
  });

  it('ignores a header sent straight to the origin, and rubbish values', () => {
    expect(visitorIp('203.0.113.7', '198.51.100.9', isCf)).toBe('203.0.113.7');
    expect(visitorIp('104.16.0.1', 'not-an-ip', isCf)).toBe('104.16.0.1');
    expect(visitorIp('104.16.0.1', undefined, isCf)).toBe('104.16.0.1');
  });

  it('accepts overridden ranges and skips malformed entries', () => {
    const custom = cloudflareMatcher(['203.0.113.0/24', 'bogus', '1.2.3.4']);
    expect(custom('203.0.113.50')).toBe(true);
    expect(custom('104.16.0.1')).toBe(false);
  });
});
