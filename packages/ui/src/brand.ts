import { fontPair, themeCss, type BrandData } from '@flourishive/schemas';

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

/** What the brand says beyond the product name: sign-in bullets, support and legal links. */
export const brandExtras = {
  bullets: [] as string[],
  supportEmail: '',
  supportPhone: '',
  supportUrl: '',
  termsUrl: '',
  privacyUrl: '',
  logoLight: '',
  logoDark: '',
  panelImage: '',
};

/** Where a brand picture is served from. */
export const assetUrl = (id: string): string =>
  id ? `${brand.apiUrl.replace(/\/$/, '')}/v1/public/brand-assets/${id}` : '';

let productBrand: BrandData | null = null;

const STYLE_ID = 'fh-brand';
const FONT_ID = 'fh-brand-fonts';

/**
 * Applies a brand to the page: the product name and sign-in words, the colours (as CSS variables for light
 * and dark), the fonts, and the title. Call it again with a company's brand to show that company's look;
 * `applyProductBrand` puts the product's back.
 */
export function applyBrand(
  data: BrandData,
  options: { titleSuffix?: string; remember?: boolean } = {},
) {
  if (options.remember) productBrand = data;
  brand.appName = data.displayName;
  brand.tagline = data.signIn.headline || data.signIn.tagline || brand.tagline;
  brandExtras.bullets = data.signIn.bullets;
  brandExtras.supportEmail = data.support.email;
  brandExtras.supportPhone = data.support.phone;
  brandExtras.supportUrl = data.support.url;
  brandExtras.termsUrl = data.legal.termsUrl;
  brandExtras.privacyUrl = data.legal.privacyUrl;
  brandExtras.logoLight = assetUrl(data.assets.logoLight);
  brandExtras.logoDark = assetUrl(data.assets.logoDark || data.assets.logoLight);
  brandExtras.panelImage = assetUrl(data.assets.panelImage);
  if (typeof document === 'undefined') return;

  const pair = fontPair(data.fonts.pairId);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent =
    themeCss(data.theme) +
    `:root{--font-ui:'${pair.body}',system-ui,-apple-system,'Segoe UI',sans-serif;--font-display:'${pair.heading}','${pair.body}',system-ui,sans-serif}`;

  let link = document.getElementById(FONT_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = FONT_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== pair.href) link.href = pair.href;

  // The favicon: the brand's own, or whatever the page shipped with.
  let icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (data.assets.favicon) {
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    if (!icon.dataset.fhOriginal) icon.dataset.fhOriginal = icon.getAttribute('href') ?? '-';
    icon.href = assetUrl(data.assets.favicon);
  } else if (icon?.dataset.fhOriginal) {
    if (icon.dataset.fhOriginal === '-') icon.removeAttribute('href');
    else icon.href = icon.dataset.fhOriginal;
    delete icon.dataset.fhOriginal;
  }

  // The company's default colour mode, unless this person already chose one.
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem('fh-theme');
  } catch {
    /* storage unavailable */
  }
  if (chosen !== 'light' && chosen !== 'dark') {
    const m = data.theme.defaultMode;
    const dark =
      m === 'dark' || (m === 'system' && matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  const suffix = options.titleSuffix ?? titleSuffix;
  if (options.titleSuffix !== undefined) titleSuffix = options.titleSuffix;
  document.title = suffix ? `${brand.appName} ${suffix}` : brand.appName;
}

let titleSuffix = '';

/** Back to the product's own look (after leaving a company's page). */
export function applyProductBrand() {
  if (productBrand) applyBrand(productBrand);
}

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
  // The product's brand from the API wins over brand.json, which stays as the fallback (D-62).
  try {
    const res = await fetch(`${brand.apiUrl.replace(/\/$/, '')}/v1/public/brand`, {
      cache: 'no-cache',
    });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const data = (await res.json()) as BrandData;
      if (data?.displayName && data.theme && data.signIn) {
        applyBrand(data, { remember: true, titleSuffix: options.titleSuffix ?? '' });
        return brand;
      }
    }
  } catch {
    // API unreachable: brand.json and the defaults stand
  }
  if (typeof document !== 'undefined')
    document.title = options.titleSuffix
      ? `${brand.appName} ${options.titleSuffix}`
      : brand.appName;
  return brand;
}
