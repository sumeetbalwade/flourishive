import { resolveTxt, resolveCname } from 'node:dns/promises';

export type CheckState = 'pass' | 'warn';
export interface DnsCheck {
  name: 'SPF' | 'DKIM' | 'DMARC';
  state: CheckState;
  /** What we found, in plain words. */
  found: string;
  /** What to do next, written for someone who has never edited DNS. */
  hint: string;
}
export interface DnsReport {
  domain: string;
  checkedAt: string;
  checks: DnsCheck[];
}

export interface Resolver {
  txt(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
}

export const systemResolver: Resolver = {
  txt: async (n) => (await resolveTxt(n)).map((c) => c.join('')),
  cname: async (n) => resolveCname(n),
};

const COMMON_SELECTORS = [
  'google',
  'default',
  'selector1',
  'selector2',
  'k1',
  's1',
  's2',
  'mail',
  'dkim',
  'zoho',
];

/** What a provider's SPF record should mention, keyed by a piece of the mail server's name. */
const PROVIDER_SPF: [string, string][] = [
  ['gmail', '_spf.google.com'],
  ['google', '_spf.google.com'],
  ['office365', 'spf.protection.outlook.com'],
  ['outlook', 'spf.protection.outlook.com'],
  ['zoho', 'zoho'],
  ['sendgrid', 'sendgrid.net'],
  ['amazonaws', 'amazonses.com'],
  ['mailgun', 'mailgun.org'],
];

const safe = async (f: () => Promise<string[]>) => {
  try {
    return await f();
  } catch {
    return [];
  }
};

/** SPF, DKIM and DMARC for the sending domain. A warning never blocks activation; it explains what to fix. */
export async function buildDnsReport(
  domain: string,
  opts: {
    smtpHost?: string | null;
    dkimSelector?: string;
    resolver?: Resolver;
  },
): Promise<DnsReport> {
  const r = opts.resolver ?? systemResolver;
  const checks: DnsCheck[] = [];

  const spf = (await safe(() => r.txt(domain))).find((t) =>
    t.toLowerCase().startsWith('v=spf1'),
  );
  const provider = PROVIDER_SPF.find(([k]) =>
    (opts.smtpHost ?? '').toLowerCase().includes(k),
  )?.[1];
  if (!spf)
    checks.push({
      name: 'SPF',
      state: 'warn',
      found: `${domain} has no SPF record.`,
      hint: `Ask whoever manages ${domain} to add a TXT record on ${domain} that says which servers may send for it${provider ? `, for example: v=spf1 include:${provider} ~all` : ''}.`,
    });
  else if (provider && !spf.toLowerCase().includes(provider))
    checks.push({
      name: 'SPF',
      state: 'warn',
      found: `SPF exists but does not mention ${provider}.`,
      hint: `Add include:${provider} to the existing SPF record, before the ending (~all or -all). Keep it as one record.`,
    });
  else
    checks.push({
      name: 'SPF',
      state: 'pass',
      found: 'SPF record found.',
      hint: 'Nothing to do.',
    });

  const selectors = opts.dkimSelector ? [opts.dkimSelector] : COMMON_SELECTORS;
  let dkimAt: string | null = null;
  for (const sel of selectors) {
    const name = `${sel}._domainkey.${domain}`;
    const txt = (await safe(() => r.txt(name))).find((t) =>
      /v=DKIM1|p=/i.test(t),
    );
    const cname = txt ? [] : await safe(() => r.cname(name));
    if (txt || cname.length) {
      dkimAt = sel;
      break;
    }
  }
  checks.push(
    dkimAt
      ? {
          name: 'DKIM',
          state: 'pass',
          found: `DKIM key found (selector “${dkimAt}”).`,
          hint: 'Nothing to do.',
        }
      : {
          name: 'DKIM',
          state: 'warn',
          found: opts.dkimSelector
            ? `No DKIM key under “${opts.dkimSelector}”.`
            : 'No DKIM key found under the usual names.',
          hint: 'In your email provider’s admin page, turn on DKIM signing. It shows a record to add to your domain’s DNS. If you know its name (the “selector”), type it above and check again.',
        },
  );

  const dmarc = (await safe(() => r.txt(`_dmarc.${domain}`))).find((t) =>
    t.toLowerCase().startsWith('v=dmarc1'),
  );
  if (!dmarc)
    checks.push({
      name: 'DMARC',
      state: 'warn',
      found: 'No DMARC record.',
      hint: `Add a TXT record named _dmarc.${domain} with the value: v=DMARC1; p=none; rua=mailto:you@${domain}. It starts in watch-only mode and is safe.`,
    });
  else if (/p=none/i.test(dmarc))
    checks.push({
      name: 'DMARC',
      state: 'warn',
      found: 'DMARC is on but only watching (p=none).',
      hint: 'That is fine to start. Once reports look clean, change p=none to p=quarantine so spoofed mail is held back.',
    });
  else
    checks.push({
      name: 'DMARC',
      state: 'pass',
      found: 'DMARC is enforcing.',
      hint: 'Nothing to do.',
    });

  return { domain, checkedAt: new Date().toISOString(), checks };
}
