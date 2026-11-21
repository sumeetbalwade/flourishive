import { brand, brandSlug, loadBrand } from '@flourishive/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

const original = { ...brand };
afterEach(() => {
  Object.assign(brand, original);
  vi.unstubAllGlobals();
});

const reply = (body: unknown, type = 'application/json') =>
  vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': type }),
    json: async () => body,
  });

describe('brand', () => {
  it('keeps the built-in name when there is no brand.json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await loadBrand({});
    expect(brand.appName).toBe('Flourishive');
    expect(document.title).toBe('Flourishive');
  });

  it('applies the build defaults, then brand.json on top', async () => {
    vi.stubGlobal('fetch', reply({ appName: 'Acme HR', tenantDomain: 'acmehr.com' }));
    await loadBrand(
      { appName: 'Build Name', apiUrl: 'https://api.acmehr.com' },
      { titleSuffix: 'Admin' },
    );
    expect(brand.appName).toBe('Acme HR');
    expect(brand.tenantDomain).toBe('acmehr.com');
    expect(brand.apiUrl).toBe('https://api.acmehr.com');
    expect(brandSlug()).toBe('acme-hr');
    expect(document.title).toBe('Acme HR Admin');
  });

  it('ignores blank values, other types, and a server that answers with HTML', async () => {
    vi.stubGlobal('fetch', reply({ appName: '   ', tagline: 42 }));
    await loadBrand({});
    expect(brand.appName).toBe('Flourishive');
    vi.stubGlobal('fetch', reply({ appName: 'Hijack' }, 'text/html'));
    await loadBrand({});
    expect(brand.appName).toBe('Flourishive');
  });
});
