import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BACKOFF_MINUTES, sign } from './webhooks.service.js';

describe('webhook signature', () => {
  it('is HMAC-SHA256 over timestamp, a dot and the exact body', () => {
    const header = sign('whsec_x', 1_700_000_000, '{"a":1}');
    const expected = createHmac('sha256', 'whsec_x')
      .update('1700000000.{"a":1}')
      .digest('hex');
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });
  it('changes when the body, the time or the secret changes', () => {
    const base = sign('s', 1, 'b');
    expect(sign('s', 1, 'c')).not.toBe(base);
    expect(sign('s', 2, 'b')).not.toBe(base);
    expect(sign('t', 1, 'b')).not.toBe(base);
  });
});

describe('retry schedule', () => {
  it('backs off and covers about a day', () => {
    expect(BACKOFF_MINUTES).toEqual([1, 5, 30, 120, 720]);
    expect(BACKOFF_MINUTES.reduce((a, b) => a + b, 0)).toBeGreaterThan(12 * 60);
  });
});
