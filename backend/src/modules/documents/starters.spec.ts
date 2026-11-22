import { BUILT_IN, placeholdersIn } from './fill.js';
import { LAYOUTS } from './layouts/registry.js';
import { STARTER_TEMPLATES } from './starters.js';

describe('starter templates', () => {
  it('cover all four letter types once each', () => {
    expect(STARTER_TEMPLATES.map((t) => t.letterType).sort()).toEqual([
      'CERTIFICATE',
      'EXPERIENCE',
      'OFFER',
      'REFERENCE',
    ]);
  });

  it.each(STARTER_TEMPLATES)(
    '$name fits its layout and every placeholder has a field',
    (t) => {
      const layout = LAYOUTS[t.layoutKey]!;
      const parsed = layout.contentSchema.safeParse({
        ...layout.defaultContent,
        ...t.content,
      });
      expect(parsed.success).toBe(true);
      const keys = new Set(t.fields.map((f) => f.key));
      expect(keys.size).toBe(t.fields.length);
      const used = Object.values(parsed.data ?? {}).flatMap(placeholdersIn);
      for (const k of used)
        expect(keys.has(k) || (BUILT_IN as readonly string[]).includes(k)).toBe(
          true,
        );
    },
  );
});
