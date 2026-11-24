import { ipAllowed } from './ip-allowlist.js';

describe('ipAllowed', () => {
  it('allows everyone when no ranges are set', () => {
    expect(ipAllowed('8.8.8.8', [])).toBe(true);
  });
  it('matches a range and a single address', () => {
    expect(ipAllowed('203.0.113.77', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(ipAllowed('10.0.0.5', ['10.0.0.5'])).toBe(true);
  });
  it('treats an IPv4-mapped address as IPv4', () => {
    expect(ipAllowed('::ffff:203.0.113.9', ['203.0.113.0/24'])).toBe(true);
  });
  it('matches IPv6 ranges and refuses an unknown visitor', () => {
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(ipAllowed(undefined, ['10.0.0.0/8'])).toBe(false);
  });
});
