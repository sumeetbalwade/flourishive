import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../platform/config/config.js';
import { CompanyDnsService } from './company-dns.service.js';

const config = (over: Partial<AppConfig> = {}) =>
  ({
    APP_DOMAIN: 'example.in',
    CLOUDFLARE_API_TOKEN: 'x'.repeat(40),
    CLOUDFLARE_ZONE_ID: 'a'.repeat(32),
    DNS_TARGET_IP: '203.0.113.7',
    DNS_PROXIED: false,
    ...over,
  }) as AppConfig;

function cloudflare(existing: unknown[]) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const result =
        (init.method ?? 'GET') === 'GET' ? existing : { id: 'new' };
      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('company addresses in Cloudflare', () => {
  it('does nothing when it is not configured', async () => {
    const calls = cloudflare([]);
    const dns = new CompanyDnsService(config({ DNS_TARGET_IP: undefined }));
    expect(await dns.ensure('acme')).toBe('off');
    expect(calls).toHaveLength(0);
  });

  it('creates one A record for the company name, not a wildcard', async () => {
    const calls = cloudflare([]);
    const dns = new CompanyDnsService(config());
    expect(await dns.ensure('acme')).toBe('created');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      type: 'A',
      name: 'acme.example.in',
      content: '203.0.113.7',
      proxied: false,
    });
    expect(JSON.stringify(calls)).not.toContain('*');
  });

  it('leaves a correct record alone and fixes a wrong one', async () => {
    cloudflare([{ id: 'r1', content: '203.0.113.7', proxied: false }]);
    expect(await new CompanyDnsService(config()).ensure('acme')).toBe('exists');
    const calls = cloudflare([
      { id: 'r1', content: '198.51.100.1', proxied: false },
    ]);
    expect(await new CompanyDnsService(config()).ensure('acme')).toBe(
      'updated',
    );
    expect(calls.at(-1)).toMatchObject({ method: 'PUT' });
    expect(calls.at(-1)!.url).toContain('/dns_records/r1');
  });

  it('reports Cloudflare errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errors: [{ message: 'no access' }],
            }),
            { status: 403 },
          ),
      ),
    );
    await expect(
      new CompanyDnsService(config()).ensure('acme'),
    ).rejects.toThrow('no access');
  });
});
