import { buildStory, classifyError, fingerprint, scrub } from './stories.js';

describe('error stories', () => {
  it('names who, what they did and what to try when the host cannot be reached', () => {
    const err = Object.assign(
      new Error('getaddrinfo ENOTFOUND timestamp.digicert.com'),
      { code: 'ENOTFOUND' },
    );
    const story = buildStory({
      ...classifyError(err),
      who: 'Asha (HR admin, Flourisense)',
      method: 'POST',
      route: '/v1/documents/:id/send',
    });
    expect(story).toContain('Asha (HR admin, Flourisense)');
    expect(story).toContain('sent a letter for signature');
    expect(story).toContain('timestamp.digicert.com');
    expect(story).toContain('Integrations');
  });

  it('falls back to a plain account for an error it does not know', () => {
    const story = buildStory({
      ...classifyError(new Error('boom')),
      who: null,
      method: 'GET',
      route: '/v1/widgets',
    });
    expect(story.startsWith('Someone')).toBe(true);
    expect(story).toContain('share the reference');
  });

  it('groups the same fault together whatever the message says', () => {
    const a = Object.assign(new Error('user 1 not found'), { code: 'P2025' });
    const b = Object.assign(new Error('user 2 not found'), { code: 'P2025' });
    expect(fingerprint(a, '/v1/x')).toBe(fingerprint(b, '/v1/x'));
    expect(fingerprint(a, '/v1/x')).not.toBe(
      fingerprint(new Error('other'), '/v1/x'),
    );
  });

  it('removes addresses, tokens and long hex strings from text', () => {
    const t = scrub(
      'sent to asha@example.com with abcdef0123456789abcdef0123456789 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij',
    );
    expect(t).not.toContain('asha@');
    expect(t).not.toContain('abcdef0123');
    expect(t).not.toContain('eyJ');
  });
});
