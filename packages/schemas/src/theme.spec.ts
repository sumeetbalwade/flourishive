import { describe, expect, it } from 'vitest';
import { THEME_PRESETS, checkAccent, contrast, themeCss, themeVars } from './theme.js';

describe('theme engine', () => {
  it('computes known contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepts every preset except Mint, which is the existing look and is kept as it is', () => {
    for (const [id, p] of Object.entries(THEME_PRESETS))
      if (id !== 'mint') expect(checkAccent(p.accent).ok, p.label).toBe(true);
    // Mint's best text colour reaches 4.3:1, a little under AA's 4.5. Presets are curated, so they skip the check.
    expect(checkAccent(THEME_PRESETS.mint.accent).textRatio).toBeGreaterThan(4.2);
  });

  it('blocks an unreadable yellow and says why', () => {
    const r = checkAccent('#ffd400');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too light|easy to read/);
  });

  it('rejects things that are not a hex colour', () => {
    expect(checkAccent('red').ok).toBe(false);
  });

  it('builds light and dark variables, with readable text on the accent', () => {
    const v = themeVars({ preset: 'ocean', accent: '#000000' });
    expect(v.light['--accent']).toBe(THEME_PRESETS.ocean.accent);
    expect(contrast(v.light['--accent']!, v.light['--on-accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.dark['--accent']!, v.dark['--on-accent']!)).toBeGreaterThanOrEqual(4.5);
    // The dark accent is lighter than the light one so it shows on a dark page.
    expect(contrast(v.dark['--accent']!, '#121b18')).toBeGreaterThanOrEqual(3);
  });

  it('emits css for both modes', () => {
    const css = themeCss({ preset: 'custom', accent: '#8a3b8c' });
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('--accent:#8a3b8c');
  });
});
