/**
 * Maps between a company's short name and its address, using TENANT_URL_TEMPLATE
 * (for example https://{slug}.flourishive.in). Pure functions so they are easy to test.
 */
export function tenantUrl(template: string, slug: string): string {
  return template.replace('{slug}', slug);
}

/** The company slug an Origin header points at, or null for any other origin (app., admin., localhost...). */
export function slugFromOrigin(
  template: string,
  origin: string | undefined,
): string | null {
  if (!origin) return null;
  const [before, after = ''] = template.split('{slug}');
  if (!origin.startsWith(before ?? '') || !origin.endsWith(after)) return null;
  const slug = origin.slice(
    (before ?? '').length,
    origin.length - after.length,
  );
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
}

/** Turns CORS_ORIGINS entries into a matcher. `*` inside an entry stands for one subdomain label. */
export function originMatcher(
  entries: string[],
): (origin: string | undefined) => boolean {
  const patterns = entries.map(
    (e) =>
      new RegExp(
        '^' +
          e.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') +
          '$',
      ),
  );
  return (origin) => !!origin && patterns.some((p) => p.test(origin));
}

/** The bare domain behind a TENANT_URL_TEMPLATE, for example https://{slug}.flourishive.in gives flourishive.in. */
export function ownDomain(template: string): string {
  return template
    .replace(/^https?:\/\//, '')
    .replace('{slug}.', '')
    .replace('{slug}', '')
    .replace(/[/:].*$/, '');
}

/** True for a host that is our own domain or any address under it (a custom address may not be one). */
export function isOwnHost(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The hostname of an Origin header, or null when it is not a plain http(s) origin. */
export function hostOfOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.hostname
      : null;
  } catch {
    return null;
  }
}
