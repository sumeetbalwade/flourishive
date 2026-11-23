import { buildDnsReport, type Resolver } from './dns-report.js';
import { explainMailError, maskAddress } from './mail-errors.js';
import { isPrivateAddress, resolvePublicSmtpHost } from './net-guard.js';

describe('SMTP host guard (D-60)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '142.250.1.1', '2607:f8b0:4004::1'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it('only allows the standard mail ports', async () => {
    await expect(
      resolvePublicSmtpHost('mail.example.com', 22, async () => ['8.8.8.8']),
    ).rejects.toThrow(/ports/);
    await expect(
      resolvePublicSmtpHost('mail.example.com', 587, async () => ['8.8.8.8']),
    ).resolves.toBe('8.8.8.8');
  });

  it('refuses a name that points at a private address, even among public ones', async () => {
    await expect(
      resolvePublicSmtpHost('evil.example.com', 587, async () => [
        '8.8.8.8',
        '169.254.169.254',
      ]),
    ).rejects.toThrow(/private network/);
    await expect(resolvePublicSmtpHost('127.0.0.1', 25)).rejects.toThrow(
      /private network/,
    );
  });

  it('says so when the name does not exist', async () => {
    await expect(
      resolvePublicSmtpHost('nope.invalid', 587, async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow(/could not be found/);
  });
});

describe('plain-words mail errors', () => {
  it('explains a Gmail login refusal', () => {
    expect(
      explainMailError({
        code: 'EAUTH',
        responseCode: 535,
        response: '535-5.7.8 Username and Password not accepted (gmail)',
      }),
    ).toMatch(/app password/);
  });
  it('explains refused connections and unknown hosts', () => {
    expect(explainMailError({ code: 'ECONNREFUSED' })).toMatch(/port/);
    expect(explainMailError({ code: 'ENOTFOUND' })).toMatch(
      /could not be found/,
    );
  });
  it('falls back to something readable', () => {
    expect(explainMailError(new Error('boom'))).toMatch(/did not accept/);
  });
  it('masks addresses', () => {
    expect(maskAddress('asha.k@gmail.com')).toBe('as***@gmail.com');
  });
});

const fake = (txt: Record<string, string[]>): Resolver => ({
  txt: async (n) => {
    if (!txt[n]) throw new Error('ENODATA');
    return txt[n]!;
  },
  cname: async () => {
    throw new Error('ENODATA');
  },
});

describe('SPF, DKIM and DMARC report', () => {
  it('passes a complete setup', async () => {
    const r = await buildDnsReport('acme.in', {
      smtpHost: 'smtp.gmail.com',
      resolver: fake({
        'acme.in': ['v=spf1 include:_spf.google.com ~all'],
        'google._domainkey.acme.in': ['v=DKIM1; k=rsa; p=ABC'],
        '_dmarc.acme.in': ['v=DMARC1; p=quarantine'],
      }),
    });
    expect(r.checks.map((c) => c.state)).toEqual(['pass', 'pass', 'pass']);
  });

  it('shows an amber warning for DMARC that only watches', async () => {
    const r = await buildDnsReport('acme.in', {
      smtpHost: 'smtp.gmail.com',
      resolver: fake({
        'acme.in': ['v=spf1 include:_spf.google.com ~all'],
        'google._domainkey.acme.in': ['v=DKIM1; p=ABC'],
        '_dmarc.acme.in': ['v=DMARC1; p=none'],
      }),
    });
    const dmarc = r.checks.find((c) => c.name === 'DMARC')!;
    expect(dmarc.state).toBe('warn');
    expect(dmarc.hint).toMatch(/p=quarantine/);
  });

  it('warns on missing records and tells a non-technical admin what to add', async () => {
    const r = await buildDnsReport('acme.in', {
      smtpHost: 'smtp.gmail.com',
      resolver: fake({}),
    });
    expect(r.checks.every((c) => c.state === 'warn')).toBe(true);
    expect(r.checks[0]!.hint).toMatch(/include:_spf.google.com/);
    expect(r.checks[2]!.hint).toMatch(/_dmarc.acme.in/);
  });

  it('warns when SPF does not mention the provider', async () => {
    const r = await buildDnsReport('acme.in', {
      smtpHost: 'smtp.gmail.com',
      resolver: fake({ 'acme.in': ['v=spf1 include:other.example ~all'] }),
    });
    expect(r.checks[0]!.state).toBe('warn');
  });

  it('checks only the selector the admin typed', async () => {
    const r = await buildDnsReport('acme.in', {
      dkimSelector: 'mine',
      resolver: fake({ 'mine._domainkey.acme.in': ['v=DKIM1; p=Z'] }),
    });
    expect(r.checks.find((c) => c.name === 'DKIM')!.found).toMatch(/mine/);
  });
});
