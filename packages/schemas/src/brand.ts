import { z } from 'zod';
import { checkAccent, fontPairIds, presetIds } from './theme.js';

/** Branding (D-61, D-62): what a company or the product looks and sounds like. */
const url = z
  .string()
  .trim()
  .max(300)
  .regex(/^https?:\/\/\S+$/i, 'Use a web address starting with https://');
const optionalUrl = url.or(z.literal(''));
const text = (max: number) => z.string().trim().max(max);

/** Reading a theme never fails on contrast: a colour saved before the check existed must still load. */
export const themeShape = z.object({
  preset: z.enum([...presetIds, 'custom']),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a colour like #2a9158'),
  defaultMode: z.enum(['light', 'dark', 'system']),
});

/** Saving a theme checks that its accent is readable (WCAG AA). */
export const themeInput = themeShape.superRefine((t, ctx) => {
  if (t.preset !== 'custom') return;
  const c = checkAccent(t.accent);
  if (!c.ok)
    ctx.addIssue({ code: 'custom', path: ['accent'], message: c.reason ?? 'Pick another colour' });
});

/** Everything a brand can say. A company's brand holds only what it changes; the rest comes from the product's. */
export const brandData = z.object({
  displayName: text(60).min(1),
  theme: themeShape,
  fonts: z.object({ pairId: z.enum(fontPairIds) }),
  signIn: z.object({
    headline: text(120),
    tagline: text(160),
    bullets: z.array(text(120).min(1)).max(4),
  }),
  email: z.object({
    footerText: text(200),
    address: text(200),
  }),
  support: z.object({
    email: z.string().trim().email().max(191).or(z.literal('')),
    phone: text(40),
    url: optionalUrl,
  }),
  /** Product only: companies cannot change these. */
  legal: z.object({ termsUrl: optionalUrl, privacyUrl: optionalUrl }),
});
export type BrandData = z.infer<typeof brandData>;

/** Each group can be set on its own; inside a group, give the whole group. */
export const brandPatch = z.object({
  displayName: brandData.shape.displayName.optional(),
  theme: themeInput.optional(),
  fonts: brandData.shape.fonts.optional(),
  signIn: brandData.shape.signIn.optional(),
  email: brandData.shape.email.optional(),
  support: brandData.shape.support.optional(),
  legal: brandData.shape.legal.optional(),
});

export type BrandPatch = z.infer<typeof brandPatch>;

export const DEFAULT_BRAND_DATA: BrandData = {
  displayName: 'Flourishive',
  theme: { preset: 'mint', accent: '#2a9158', defaultMode: 'system' },
  fonts: { pairId: 'outfit-hanken' },
  signIn: {
    headline: 'HR, signed and sealed.',
    tagline: '',
    bullets: [
      'One home for every employee and intern record',
      'Letters drafted, approved and e-signed in minutes',
      'Role-based access with two-step sign-in',
    ],
  },
  email: { footerText: '', address: '' },
  support: { email: '', phone: '', url: '' },
  legal: { termsUrl: '', privacyUrl: '' },
};

/** The product's brand, with each group of a company's brand laid over it. */
export function mergeBrand(...layers: (BrandPatch | null | undefined)[]): BrandData {
  const out: BrandData = structuredClone(DEFAULT_BRAND_DATA);
  for (const l of layers) {
    if (!l) continue;
    if (l.displayName) out.displayName = l.displayName;
    if (l.theme) out.theme = l.theme;
    if (l.fonts) out.fonts = l.fonts;
    if (l.signIn) out.signIn = l.signIn;
    if (l.email) out.email = l.email;
    if (l.support) out.support = l.support;
    if (l.legal) out.legal = l.legal;
  }
  return out;
}

export const brandStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

/** What the editor needs: what is live, the unpublished draft, and the result of laying one over the other. */
/** A stored patch as read back: like `brandPatch`, but a colour saved before the contrast check still loads. */
const brandPatchRead = brandPatch.extend({ theme: themeShape.optional() });

export const brandEditorState = z.object({
  /** What a company inherits from the product (for the product's own editor: the built-in defaults). */
  inherited: brandData,
  published: brandPatchRead.nullable(),
  publishedVersion: z.number().nullable(),
  publishedAt: z.string().nullable(),
  draft: brandPatchRead.nullable(),
  hasDraft: z.boolean(),
  canRevert: z.boolean(),
  /** What the app looks like with the draft applied: the brand the editor previews. */
  working: brandData,
});
export type BrandEditorState = z.infer<typeof brandEditorState>;

export const saveBrandDraftBody = z.object({ draft: brandPatch });
export type SaveBrandDraftBody = z.infer<typeof saveBrandDraftBody>;

/** The public brand screens load before sign-in. */
export const publicBrand = z.any();
export type PublicBrand = BrandData;
