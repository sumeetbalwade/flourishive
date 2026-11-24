import { z } from 'zod';

/** A company's own web address, such as hr.company.com (D-69). */
export const domainStatus = z.enum(['PENDING_DNS', 'VERIFIED', 'ACTIVE', 'FAILED']);
export type DomainStatus = z.infer<typeof domainStatus>;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lower-cases and trims a typed address, dropping a pasted scheme, path and trailing dot. */
export function cleanHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

/** A public DNS name with at least three labels' worth of structure (a subdomain of the company's own site). */
export function isValidHostname(host: string): boolean {
  if (host.length < 4 || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 3) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  // The last label is a real top-level name, never a number (so no IP addresses).
  return /^[a-z]{2,}$/.test(labels[labels.length - 1] ?? '');
}

export const addDomainBody = z.object({
  hostname: z
    .string()
    .transform(cleanHostname)
    .refine(isValidHostname, 'Enter an address like hr.yourcompany.com'),
});
export type AddDomainBody = z.infer<typeof addDomainBody>;

export const domainView = z.object({
  id: z.string(),
  hostname: z.string(),
  status: domainStatus,
  /** What to add at the domain's DNS provider. */
  records: z.array(
    z.object({
      type: z.enum(['CNAME', 'TXT']),
      name: z.string(),
      value: z.string(),
      /** True once we have seen this record. */
      found: z.boolean(),
    }),
  ),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
  /** True when emailed links use this address. */
  primary: z.boolean(),
  createdAt: z.string(),
});
export type DomainView = z.infer<typeof domainView>;

export const domainsState = z.object({
  /** The address the company already has on our domain. */
  defaultAddress: z.string(),
  domains: z.array(domainView),
  /** Where the CNAME must point. */
  cnameTarget: z.string(),
});
export type DomainsState = z.infer<typeof domainsState>;

export const setPrimaryDomainBody = z.object({
  /** A verified hostname, or null to use the address on our domain. */
  hostname: z.string().nullable(),
});

/** The company a custom address belongs to (public: the sign-in page asks before anyone is signed in). */
export const hostLookup = z.object({ slug: z.string() });
