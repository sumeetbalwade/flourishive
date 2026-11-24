import { describe, expect, it } from 'vitest';
import { isCustomHost } from '@flourishive/ui';
import { detectCompany } from './company.ts';

const base = {
  hostname: 'app.flourishive.in',
  search: '',
  hash: '',
  saved: '',
  domain: 'flourishive.in',
};

describe('detectCompany', () => {
  it('reads the company from its address', () => {
    expect(detectCompany({ ...base, hostname: 'acme.flourishive.in' })).toEqual({
      slug: 'acme',
      source: 'address',
    });
  });

  it('ignores the platform’s own names and nested hosts', () => {
    for (const hostname of [
      'app.flourishive.in',
      'admin.flourishive.in',
      'a.b.flourishive.in',
      'flourishive.in',
    ])
      expect(detectCompany({ ...base, hostname }).source).toBe('none');
  });

  it('works on localhost subdomains in development', () => {
    expect(detectCompany({ ...base, hostname: 'acme.localhost', domain: 'localhost' }).slug).toBe(
      'acme',
    );
  });

  it('falls back to a ?tenant= link, then the last company used', () => {
    expect(detectCompany({ ...base, search: '?tenant=Acme' })).toEqual({
      slug: 'acme',
      source: 'link',
    });
    expect(detectCompany({ ...base, hash: '#/login?tenant=beta' })).toEqual({
      slug: 'beta',
      source: 'link',
    });
    expect(detectCompany({ ...base, saved: 'gamma' })).toEqual({
      slug: 'gamma',
      source: 'remembered',
    });
  });

  it('the address wins over a link, and junk is ignored', () => {
    expect(
      detectCompany({ ...base, hostname: 'acme.flourishive.in', search: '?tenant=other' }).slug,
    ).toBe('acme');
    expect(detectCompany({ ...base, search: '?tenant=%3Cscript%3E' }).source).toBe('none');
  });

  it('uses the company that owns a custom address', () => {
    expect(detectCompany({ ...base, hostname: 'hr.acme.com', hostSlug: 'acme' })).toEqual({
      slug: 'acme',
      source: 'address',
    });
  });

  it('tells a custom address from ours and from a developer machine', () => {
    expect(isCustomHost('hr.acme.com', 'flourishive.in')).toBe(true);
    expect(isCustomHost('acme.flourishive.in', 'flourishive.in')).toBe(false);
    expect(isCustomHost('flourishive.in', 'flourishive.in')).toBe(false);
    expect(isCustomHost('localhost', 'flourishive.in')).toBe(false);
    expect(isCustomHost('127.0.0.1', 'flourishive.in')).toBe(false);
  });
});
