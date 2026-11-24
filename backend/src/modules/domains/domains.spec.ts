import {
  addDomainBody,
  cleanHostname,
  isValidHostname,
} from '@flourishive/schemas';
import { describe, expect, it } from 'vitest';
import { hostOfOrigin, isOwnHost, ownDomain } from '../company/tenant-host.js';
import { checkRecords } from './domains.service.js';

describe('address checks', () => {
  it('cleans what people paste', () => {
    expect(cleanHostname(' https://HR.Acme.com/jobs?x=1 ')).toBe('hr.acme.com');
    expect(cleanHostname('hr.acme.com.')).toBe('hr.acme.com');
  });
  it('accepts a subdomain and nothing else', () => {
    expect(isValidHostname('hr.acme.com')).toBe(true);
    expect(isValidHostname('hr.acme.co.in')).toBe(true);
    expect(isValidHostname('acme.com')).toBe(false);
    expect(isValidHostname('10.0.0.1')).toBe(false);
    expect(isValidHostname('a b.acme.com')).toBe(false);
    expect(isValidHostname('-x.acme.com')).toBe(false);
    expect(addDomainBody.safeParse({ hostname: 'localhost' }).success).toBe(
      false,
    );
  });
  it('knows our own domain', () => {
    expect(ownDomain('https://{slug}.flourishive.in')).toBe('flourishive.in');
    expect(ownDomain('http://{slug}.localhost:5173')).toBe('localhost');
    expect(isOwnHost('flourishive.in', 'x.flourishive.in')).toBe(true);
    expect(isOwnHost('flourishive.in', 'evilflourishive.in')).toBe(false);
    expect(hostOfOrigin('https://hr.acme.com')).toBe('hr.acme.com');
    expect(hostOfOrigin('chrome-extension://x')).toBeNull();
  });
  it('reads the two DNS records', () => {
    expect(
      checkRecords('custom.f.in', 'tok', ['Custom.F.in.'], ['tok']),
    ).toEqual({ cname: true, txt: true });
    expect(checkRecords('custom.f.in', 'tok', ['other.com'], ['tok2'])).toEqual(
      { cname: false, txt: false },
    );
  });
});
