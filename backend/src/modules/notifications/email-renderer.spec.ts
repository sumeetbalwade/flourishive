import { describe, expect, it } from 'vitest';
import { renderEmail, validateTemplate } from './email-renderer.js';
import { EMAIL_EVENTS, eventDef } from './events.js';

const brand = { name: 'Acme', accent: '#2a9158' };
const invite = eventDef('auth.invite')!;

describe('validateTemplate', () => {
  it('accepts every built-in wording', () => {
    for (const e of EMAIL_EVENTS)
      expect(validateTemplate(e, e.subject, e.body)).toEqual([]);
  });

  it('rejects a placeholder the email does not have, and lists the ones it does', () => {
    const p = validateTemplate(invite, 'Hi', 'Click {{lnk}} [[Go|{{link}}]]');
    expect(p.join(' ')).toContain('{{lnk}}');
    expect(p.join(' ')).toContain('{{link}}');
  });

  it('requires the link or code to stay', () => {
    expect(validateTemplate(invite, 'Hi', 'No link here')).toEqual([
      'The email must keep {{link}}, or the recipient cannot use it',
    ]);
  });

  it('rejects half-written braces and unsafe link targets', () => {
    expect(validateTemplate(invite, 'Hi {{', '[[Go|{{link}}]]').length).toBe(1);
    expect(
      validateTemplate(invite, 'Hi', '[[Go|{{link}}]] [x](javascript:alert(1))')
        .length,
    ).toBe(1);
  });
});

describe('renderEmail', () => {
  it('escapes values in the html but not in the text or subject', () => {
    const r = renderEmail(
      'Hi {{name}}',
      'Hello **{{name}}**',
      { name: '<b>Tom & Jerry</b>' },
      brand,
    );
    expect(r.html).toContain('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;');
    expect(r.html).not.toContain('<b>Tom');
    expect(r.subject).toBe('Hi <b>Tom & Jerry</b>');
    expect(r.text).toBe('Hello <b>Tom & Jerry</b>');
  });

  it('does not format or re-substitute what a value contains', () => {
    const r = renderEmail('S', '{{a}}', { a: '**x** {{b}}', b: 'LEAK' }, brand);
    expect(r.html).not.toContain('<strong>');
    expect(r.html).not.toContain('LEAK');
  });

  it('renders a button and a plain-text equivalent', () => {
    const r = renderEmail(
      'S',
      'Open it:\n\n[[Open|{{link}}]]',
      { link: 'https://x.test/a?b=1&c=2' },
      brand,
    );
    expect(r.html).toContain('href="https://x.test/a?b=1&amp;c=2"');
    expect(r.text).toBe('Open it:\n\nOpen: https://x.test/a?b=1&c=2');
  });

  it('never makes a non-web link clickable', () => {
    const r = renderEmail(
      'S',
      '[[Go|{{link}}]]',
      { link: 'javascript:alert(1)' },
      brand,
    );
    expect(r.html).toContain('href="#"');
  });

  it('keeps a subject on one line', () => {
    const r = renderEmail(
      'A {{x}}',
      'b',
      { x: 'one\r\nBcc: evil@x.test' },
      brand,
    );
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it('drops a paragraph that is only an empty placeholder', () => {
    const r = renderEmail('S', 'One\n\n{{note}}\n\nTwo', { note: '' }, brand);
    expect(r.text).toBe('One\n\nTwo');
  });

  it('forces the dark scheme for previews', () => {
    expect(renderEmail('S', 'x', {}, brand, 'dark').html).toContain('#1b201e');
  });
});
