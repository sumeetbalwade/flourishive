/**
 * Brand colour engine (D-61). From one accent it builds the accent shades for light and dark mode and
 * refuses accents that would make text unreadable (WCAG AA). Pure functions, shared by the API (which
 * validates) and every screen (which applies).
 *
 * Kept in this package rather than design-tokens because the API imports it and this one is built.
 */

type Rgb = [number, number, number];
type Lch = { l: number; c: number; h: number };

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (s: string): boolean => HEX.test(s);

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const toLinear = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toOklch(hex: string): Lch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}
function fromOklch({ l: L, c, h }: Lch): string {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return rgbToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

const withL = (hex: string, l: number): string => {
  const { c, h } = toOklch(hex);
  return fromOklch({ l: Math.min(0.97, Math.max(0.12, l)), c, h });
};

const alpha = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
};

const INK = '#07210f';
const WHITE = '#ffffff';
/** The text colour that reads best on `bg`. */
export const onColour = (bg: string): string =>
  contrast(WHITE, bg) >= contrast(INK, bg) ? WHITE : INK;

export const LIGHT_SURFACE = '#ffffff';
export const DARK_SURFACE = '#121b18';

export interface AccentCheck {
  ok: boolean;
  /** Plain-words reason when not ok. */
  reason?: string;
  /** Contrast of the best text colour on the accent (needs 4.5). */
  textRatio: number;
  /** Contrast of the accent against the page surface in light mode (needs 3). */
  surfaceRatio: number;
}

/** WCAG AA: readable text on the accent, and the accent itself visible against the page. */
export function checkAccent(hex: string): AccentCheck {
  if (!isHex(hex))
    return { ok: false, reason: 'Enter a colour like #2a9158', textRatio: 0, surfaceRatio: 0 };
  const textRatio = Math.max(contrast(WHITE, hex), contrast(INK, hex));
  const surfaceRatio = contrast(hex, LIGHT_SURFACE);
  if (textRatio < 4.5)
    return {
      ok: false,
      reason:
        'Neither white nor dark text is easy to read on this colour. Pick a stronger or deeper shade.',
      textRatio,
      surfaceRatio,
    };
  if (surfaceRatio < 3)
    return {
      ok: false,
      reason:
        'This colour is too light to stand out on a white page, so buttons and links would be hard to see. Pick a deeper shade.',
      textRatio,
      surfaceRatio,
    };
  return { ok: true, textRatio, surfaceRatio };
}

export const THEME_PRESETS = {
  mint: { label: 'Mint', accent: '#2a9158', deep: '#3d6a80', deepDark: '#2d5266' },
  bronze: { label: 'Bronze', accent: '#9a6b2f', deep: '#5c4a3a', deepDark: '#463829' },
  ocean: { label: 'Ocean', accent: '#1f6fb2', deep: '#264f78', deepDark: '#1d3d5c' },
  plum: { label: 'Plum', accent: '#8a3b8c', deep: '#5b3a6e', deepDark: '#46294f' },
  slate: { label: 'Slate', accent: '#475569', deep: '#334155', deepDark: '#263244' },
} as const;
export type ThemePresetId = keyof typeof THEME_PRESETS;
export const presetIds = Object.keys(THEME_PRESETS) as [ThemePresetId, ...ThemePresetId[]];

export interface ThemeInput {
  preset: ThemePresetId | 'custom';
  accent: string;
}

/** The accent the theme uses: the preset's own, or the custom one. */
export const accentOf = (t: ThemeInput): string =>
  t.preset === 'custom' ? t.accent : THEME_PRESETS[t.preset].accent;

type Vars = Record<string, string>;

/** CSS variables for one accent in light and dark mode. */
export function themeVars(t: ThemeInput): { light: Vars; dark: Vars } {
  const base = accentOf(t);
  const hi = withL(base, toOklch(base).l - 0.08);
  const darkAccent = toOklch(base).l < 0.72 ? withL(base, 0.78) : base;
  const darkHi = withL(darkAccent, toOklch(darkAccent).l + 0.07);
  const preset = t.preset === 'custom' ? null : THEME_PRESETS[t.preset];
  const deepL = preset?.deep ?? withL(base, 0.45);
  const deepD = preset?.deepDark ?? withL(base, 0.34);
  return {
    light: {
      '--accent': base,
      '--accent-hi': hi,
      '--accent-lo': alpha(base, 0.13),
      '--on-accent': onColour(base),
      '--deep': deepL,
      '--deep-hi': withL(deepL, toOklch(deepL).l + 0.05),
      '--on-deep': onColour(deepL),
    },
    dark: {
      '--accent': darkAccent,
      '--accent-hi': darkHi,
      '--accent-lo': alpha(darkAccent, 0.14),
      '--on-accent': onColour(darkAccent),
      '--deep': deepD,
      '--deep-hi': withL(deepD, toOklch(deepD).l + 0.05),
      '--on-deep': onColour(deepD),
    },
  };
}

/** Stylesheet text for a theme: `:root` for light, the dark selector for dark. */
export function themeCss(t: ThemeInput): string {
  const { light, dark } = themeVars(t);
  const block = (v: Vars) =>
    Object.entries(v)
      .map(([k, val]) => `${k}:${val}`)
      .join(';');
  return `:root,:root[data-theme='light']{${block(light)}}:root[data-theme='dark']{${block(dark)}}`;
}

export interface FontPair {
  id: string;
  label: string;
  heading: string;
  body: string;
  /** Google Fonts stylesheet; the app falls back to system fonts if it cannot load. */
  href: string;
}

const gf = (...families: string[]): string =>
  `https://fonts.googleapis.com/css2?${[...new Set(families)].map((f) => `family=${f}`).join('&')}&display=swap`;

export const FONT_PAIRS: FontPair[] = [
  {
    id: 'outfit-hanken',
    label: 'Outfit + Hanken Grotesk',
    heading: 'Outfit',
    body: 'Hanken Grotesk',
    href: gf('Outfit:wght@300;400;500;600', 'Hanken+Grotesk:wght@400;500;600;700'),
  },
  {
    id: 'inter',
    label: 'Inter',
    heading: 'Inter',
    body: 'Inter',
    href: gf('Inter:wght@300;400;500;600;700'),
  },
  {
    id: 'manrope',
    label: 'Manrope',
    heading: 'Manrope',
    body: 'Manrope',
    href: gf('Manrope:wght@300;400;500;600;700'),
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    heading: 'DM Sans',
    body: 'DM Sans',
    href: gf('DM+Sans:wght@300;400;500;600;700'),
  },
  {
    id: 'jakarta',
    label: 'Plus Jakarta Sans',
    heading: 'Plus Jakarta Sans',
    body: 'Plus Jakarta Sans',
    href: gf('Plus+Jakarta+Sans:wght@300;400;500;600;700'),
  },
  {
    id: 'poppins',
    label: 'Poppins',
    heading: 'Poppins',
    body: 'Poppins',
    href: gf('Poppins:wght@300;400;500;600'),
  },
  {
    id: 'source',
    label: 'Source Serif + Source Sans',
    heading: 'Source Serif 4',
    body: 'Source Sans 3',
    href: gf('Source+Serif+4:wght@300;400;500;600', 'Source+Sans+3:wght@400;500;600;700'),
  },
  {
    id: 'noto',
    label: 'Noto Sans (Hindi-friendly)',
    heading: 'Noto Sans',
    body: 'Noto Sans',
    href: gf('Noto+Sans:wght@300;400;500;600;700', 'Noto+Sans+Devanagari:wght@400;500;600'),
  },
];
export const fontPairIds = FONT_PAIRS.map((f) => f.id) as [string, ...string[]];
export const fontPair = (id: string): FontPair =>
  FONT_PAIRS.find((f) => f.id === id) ?? FONT_PAIRS[0]!;
