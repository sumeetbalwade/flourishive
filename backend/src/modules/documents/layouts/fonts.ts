import { Font } from '@react-pdf/renderer';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function fontDir(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 8; i++) {
    const p = join(dir, 'assets', 'fonts');
    if (existsSync(p)) return p;
    dir = dirname(dir);
  }
  throw new Error('assets/fonts not found');
}

let done = false;
/** Registers the embedded fonts once. Devanagari is a fallback so Hindi and Marathi text prints. */
export function registerFonts(): string[] {
  if (!done) {
    const d = fontDir();
    Font.register({ family: 'Noto Sans', src: join(d, 'NotoSans.ttf') });
    Font.register({
      family: 'Noto Sans Devanagari',
      src: join(d, 'NotoSansDevanagari.ttf'),
    });
    Font.registerHyphenationCallback((w) => [w]);
    done = true;
  }
  return ['Noto Sans', 'Noto Sans Devanagari'];
}
