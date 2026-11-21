/**
 * The product's name, tagline and addresses. Defaults come from the build (VITE_APP_NAME and so
 * on); a `brand.json` file next to index.html overrides them without a rebuild, so renaming the
 * product or moving it to another domain is a file edit on the server.
 */
export interface Brand {
  appName: string;
  tagline: string;
  /** Companies live at <slug>.<tenantDomain>. */
  tenantDomain: string;
  apiUrl: string;
}

export const brand: Brand = {
  appName: 'Flourishive',
  tagline: 'HR, signed and sealed.',
  tenantDomain: 'localhost',
  apiUrl: 'http://localhost:3000',
};

/** A file-name friendly version of the name: "Acme HR" becomes "acme-hr". */
export const brandSlug = (): string =>
  brand.appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'app';

const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function apply(source: Partial<Record<keyof Brand, unknown>>) {
  for (const key of Object.keys(brand) as (keyof Brand)[]) {
    const v = source[key];
    if (text(v)) brand[key] = v.trim();
  }
}

/**
 * Call once before the first render. Order: built-in, then the build's defaults, then brand.json.
 * A missing or broken brand.json is ignored. `titleSuffix` is added to the page title ("Admin").
 */
export async function loadBrand(
  buildDefaults: Partial<Record<keyof Brand, string | undefined>> = {},
  options: { url?: string; titleSuffix?: string } = {},
): Promise<Brand> {
  apply(buildDefaults);
  try {
    const res = await fetch(options.url ?? '/brand.json', { cache: 'no-cache' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json'))
      apply((await res.json()) as Record<string, unknown>);
  } catch {
    // no brand.json: the defaults stand
  }
  if (typeof document !== 'undefined')
    document.title = options.titleSuffix
      ? `${brand.appName} ${options.titleSuffix}`
      : brand.appName;
  return brand;
}
