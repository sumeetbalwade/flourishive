import {
  FONT_PAIRS,
  THEME_PRESETS,
  checkAccent,
  fontPair,
  themeVars,
  type BrandData,
  type BrandEditorState,
  type BrandPatch,
} from '@flourishive/schemas';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { CollapsibleSection } from './collapsible-section.tsx';
import { Input } from './input.tsx';
import { Segmented } from './segmented.tsx';
import { Skeleton } from './skeleton.tsx';

type Group = 'name' | 'fonts' | 'signIn' | 'email' | 'support' | 'legal';
type Tab = 'app' | 'signin' | 'email';

export interface BrandEditorProps {
  state: BrandEditorState | undefined;
  /** Product editor: also shows the legal links, which companies cannot change. */
  isProduct?: boolean;
  onSaveDraft: (patch: BrandPatch) => Promise<void>;
  onDiscard: () => Promise<void>;
  onPublish: () => Promise<void>;
  onRevert: () => Promise<void>;
  previewEmail: (
    patch: BrandPatch,
    scheme: 'light' | 'dark',
  ) => Promise<{ html: string; subject: string }>;
  onError: (message: string) => void;
}

/** Palette of the two modes for the preview only, so it can show dark while the page is light. */
const SURFACES = {
  light: {
    '--bg': '#eef3f1',
    '--surface': '#ffffff',
    '--surface-2': '#f2f6f5',
    '--border': '#e1e9e6',
    '--text': '#11201b',
    '--text-muted': '#55675f',
  },
  dark: {
    '--bg': '#0b1210',
    '--surface': '#121b18',
    '--surface-2': '#19251f',
    '--border': '#243630',
    '--text': '#e9f2ee',
    '--text-muted': '#9bb0a7',
  },
} as const;

const SAMPLE = 'Asha Rao · ₹1,25,000 · अनुराग';

/** The group of a brand a section edits, as it is in `b`. */
function groupOf(b: BrandData, g: Group): unknown {
  if (g === 'name') return { displayName: b.displayName, theme: b.theme };
  return b[g];
}

function applyGroup(patch: BrandPatch, g: Group, v: unknown): BrandPatch {
  if (g === 'name') {
    const n = v as { displayName: string; theme: BrandData['theme'] };
    return { ...patch, displayName: n.displayName, theme: n.theme };
  }
  return { ...patch, [g]: v };
}

function dropGroup(patch: BrandPatch, g: Group): BrandPatch {
  const next = { ...patch } as Record<string, unknown>;
  if (g === 'name') {
    delete next.displayName;
    delete next.theme;
  } else delete next[g];
  return next as BrandPatch;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Label({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="pl-1 text-[13px] font-medium text-muted">
      {children}
    </label>
  );
}

/**
 * Brand editor (D-61, D-62): sections on the left (each saves to the draft on its own), a live preview on the
 * right (app, sign-in, email; light and dark), and Publish / Revert / Discard for the draft as a whole.
 */
export function BrandEditor(p: BrandEditorProps) {
  const { state } = p;
  const [form, setForm] = useState<BrandData | null>(null);
  const [tab, setTab] = useState<Tab>('app');
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [saving, setSaving] = useState<Group | null>(null);
  const [emailHtml, setEmailHtml] = useState('');

  // Start (and restart after every save, publish or revert) from what the server says the app would look like.
  const baseKey = state
    ? JSON.stringify([state.working, state.publishedVersion, state.hasDraft])
    : '';
  useEffect(() => {
    if (state) setForm(structuredClone(state.working));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  const patchNow = useMemo<BrandPatch>(
    () => (state ? (state.draft ?? state.published ?? {}) : {}),
    [state],
  );

  // The form laid over the patch is what the preview shows.
  const livePatch = useMemo<BrandPatch>(() => {
    if (!form) return {};
    let out = patchNow;
    for (const g of ['name', 'fonts', 'signIn', 'email', 'support', 'legal'] as Group[])
      if (state && !same(groupOf(form, g), groupOf(state.working, g)))
        out = applyGroup(out, g, groupOf(form, g));
    return out;
  }, [form, patchNow, state]);

  useEffect(() => {
    if (tab !== 'email' || !form) return;
    const t = setTimeout(() => {
      p.previewEmail(livePatch, scheme)
        .then((r) => setEmailHtml(r.html))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, scheme, JSON.stringify(livePatch)]);

  // Load the chosen font so the preview and font cards show it.
  useEffect(() => {
    if (!form) return;
    const id = `brand-editor-font-${form.fonts.pairId}`;
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = fontPair(form.fonts.pairId).href;
    document.head.appendChild(l);
  }, [form]);

  if (!state || !form) return <Skeleton className="h-[40rem]" />;

  const set = <K extends keyof BrandData>(k: K, v: BrandData[K]) => setForm({ ...form, [k]: v });
  const dirty = (g: Group) => (same(groupOf(form, g), groupOf(state.working, g)) ? 0 : 1);

  const saveGroup = async (g: Group) => {
    setSaving(g);
    try {
      await p.onSaveDraft(applyGroup(patchNow, g, groupOf(form, g)));
    } catch (e) {
      p.onError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const resetGroup = (g: Group) =>
    void p.onSaveDraft(dropGroup(patchNow, g)).catch((e: Error) => p.onError(e.message));
  const discardGroup = (g: Group) => {
    const base = groupOf(state.working, g) as never;
    if (g === 'name') {
      const n = base as { displayName: string; theme: BrandData['theme'] };
      setForm({ ...form, displayName: n.displayName, theme: n.theme });
    } else setForm({ ...form, [g]: base });
  };

  const accent =
    form.theme.preset === 'custom' ? form.theme.accent : THEME_PRESETS[form.theme.preset].accent;
  const check = form.theme.preset === 'custom' ? checkAccent(form.theme.accent) : null;
  const inheritedGroup = (g: Group) =>
    !(g === 'name' ? 'theme' in patchNow || 'displayName' in patchNow : g in patchNow);

  const resetBtn = (g: Group) =>
    !p.isProduct && !inheritedGroup(g) ? (
      <Button size="sm" variant="ghost" onClick={() => resetGroup(g)}>
        Use the product’s
      </Button>
    ) : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
          {state.hasDraft ? (
            <Badge tone="warning">Unpublished changes</Badge>
          ) : (
            <Badge tone="success">Live</Badge>
          )}
          {state.publishedVersion ? (
            <span className="text-xs text-muted">Version {state.publishedVersion}</span>
          ) : null}
          <span className="mr-auto" />
          {state.hasDraft ? (
            <Button
              variant="ghost"
              onClick={() => p.onDiscard().catch((e: Error) => p.onError(e.message))}
            >
              Discard draft
            </Button>
          ) : null}
          {state.canRevert ? (
            <Button
              variant="secondary"
              onClick={() => p.onRevert().catch((e: Error) => p.onError(e.message))}
            >
              Revert to previous
            </Button>
          ) : null}
          <Button
            disabled={!state.hasDraft}
            onClick={() => p.onPublish().catch((e: Error) => p.onError(e.message))}
          >
            Publish
          </Button>
        </div>

        <CollapsibleSection
          id="brand-name"
          title="Name and colours"
          defaultOpen
          dirtyCount={dirty('name')}
          saving={saving === 'name'}
          onSave={() => saveGroup('name')}
          onDiscard={() => discardGroup('name')}
          actions={resetBtn('name')}
        >
          <div className="grid gap-5 py-5">
            <div className="grid gap-1.5">
              <Label htmlFor="brand-display">Name shown to people</Label>
              <Input
                id="brand-display"
                value={form.displayName}
                maxLength={60}
                onChange={(e) => set('displayName', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Colour theme</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  ...Object.entries(THEME_PRESETS).map(([id, t]) => ({
                    id,
                    label: t.label,
                    colour: t.accent,
                  })),
                  { id: 'custom', label: 'Custom', colour: form.theme.accent },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={form.theme.preset === o.id}
                    onClick={() =>
                      set('theme', { ...form.theme, preset: o.id as BrandData['theme']['preset'] })
                    }
                    className={`flex items-center gap-2 rounded-pill border px-4 py-2 text-sm transition-colors ${form.theme.preset === o.id ? 'border-accent bg-accent-lo' : 'border-line hover:border-line-strong'}`}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-line"
                      style={{ background: o.colour }}
                    />
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {form.theme.preset === 'custom' ? (
              <div className="grid gap-1.5">
                <Label htmlFor="brand-accent">Accent colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="Pick a colour"
                    value={form.theme.accent}
                    onChange={(e) => set('theme', { ...form.theme, accent: e.target.value })}
                    className="h-11 w-14 cursor-pointer rounded-md border border-line bg-surface"
                  />
                  <Input
                    id="brand-accent"
                    value={form.theme.accent}
                    onChange={(e) => set('theme', { ...form.theme, accent: e.target.value })}
                    className="max-w-40 font-mono"
                    aria-invalid={check ? !check.ok : undefined}
                  />
                  {check ? (
                    <Badge tone={check.ok ? 'success' : 'danger'}>
                      {check.ok ? `Readable · ${check.textRatio.toFixed(1)}:1` : 'Too hard to read'}
                    </Badge>
                  ) : null}
                </div>
                {check && !check.ok ? (
                  <p role="alert" className="pl-1 text-xs text-danger">
                    {check.reason}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label>Default look</Label>
              <Segmented
                label="Default look"
                value={form.theme.defaultMode}
                onChange={(v) => set('theme', { ...form.theme, defaultMode: v })}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'Follow device' },
                ]}
              />
              <p className="pl-1 text-xs text-faint">People can still switch for themselves.</p>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="brand-fonts"
          title="Fonts"
          dirtyCount={dirty('fonts')}
          saving={saving === 'fonts'}
          onSave={() => saveGroup('fonts')}
          onDiscard={() => discardGroup('fonts')}
          actions={resetBtn('fonts')}
        >
          <div className="grid gap-2 py-5 sm:grid-cols-2">
            {FONT_PAIRS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={form.fonts.pairId === f.id}
                onClick={() => set('fonts', { pairId: f.id })}
                className={`rounded-card border p-4 text-left transition-colors ${form.fonts.pairId === f.id ? 'border-accent bg-accent-lo' : 'border-line hover:border-line-strong'}`}
              >
                <span className="block text-lg" style={{ fontFamily: `'${f.heading}', system-ui` }}>
                  {f.label}
                </span>
                <span
                  className="mt-1 block text-sm text-muted"
                  style={{ fontFamily: `'${f.body}', system-ui` }}
                >
                  {SAMPLE}
                </span>
              </button>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="brand-signin"
          title="Sign-in page"
          dirtyCount={dirty('signIn')}
          saving={saving === 'signIn'}
          onSave={() => saveGroup('signIn')}
          onDiscard={() => discardGroup('signIn')}
          actions={resetBtn('signIn')}
        >
          <div className="grid gap-4 py-5">
            <div className="grid gap-1.5">
              <Label htmlFor="brand-headline">Headline</Label>
              <Input
                id="brand-headline"
                value={form.signIn.headline}
                maxLength={120}
                onChange={(e) => set('signIn', { ...form.signIn, headline: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="brand-tagline">Small line under the name (optional)</Label>
              <Input
                id="brand-tagline"
                value={form.signIn.tagline}
                maxLength={160}
                onChange={(e) => set('signIn', { ...form.signIn, tagline: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Points shown beside the form (up to 4)</Label>
              {form.signIn.bullets.map((b, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={`Point ${i + 1}`}
                    value={b}
                    maxLength={120}
                    onChange={(e) =>
                      set('signIn', {
                        ...form.signIn,
                        bullets: form.signIn.bullets.map((x, j) => (j === i ? e.target.value : x)),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      set('signIn', {
                        ...form.signIn,
                        bullets: form.signIn.bullets.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {form.signIn.bullets.length < 4 ? (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      set('signIn', {
                        ...form.signIn,
                        bullets: [...form.signIn.bullets, 'New point'],
                      })
                    }
                  >
                    Add a point
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="brand-email"
          title="Email footer"
          dirtyCount={dirty('email')}
          saving={saving === 'email'}
          onSave={() => saveGroup('email')}
          onDiscard={() => discardGroup('email')}
          actions={resetBtn('email')}
        >
          <div className="grid gap-4 py-5">
            <div className="grid gap-1.5">
              <Label htmlFor="brand-footer">Footer line</Label>
              <Input
                id="brand-footer"
                value={form.email.footerText}
                maxLength={200}
                placeholder="Sent by …"
                onChange={(e) => set('email', { ...form.email, footerText: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="brand-address">Postal address</Label>
              <Input
                id="brand-address"
                value={form.email.address}
                maxLength={200}
                onChange={(e) => set('email', { ...form.email, address: e.target.value })}
              />
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="brand-support"
          title="Support contact"
          dirtyCount={dirty('support')}
          saving={saving === 'support'}
          onSave={() => saveGroup('support')}
          onDiscard={() => discardGroup('support')}
          actions={resetBtn('support')}
        >
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            {(['email', 'phone', 'url'] as const).map((k) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={`brand-support-${k}`}>
                  {k === 'email' ? 'Support email' : k === 'phone' ? 'Support phone' : 'Help page'}
                </Label>
                <Input
                  id={`brand-support-${k}`}
                  value={form.support[k]}
                  onChange={(e) => set('support', { ...form.support, [k]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {p.isProduct ? (
          <CollapsibleSection
            id="brand-legal"
            title="Terms and privacy links"
            dirtyCount={dirty('legal')}
            saving={saving === 'legal'}
            onSave={() => saveGroup('legal')}
            onDiscard={() => discardGroup('legal')}
          >
            <div className="grid gap-4 py-5 sm:grid-cols-2">
              {(['termsUrl', 'privacyUrl'] as const).map((k) => (
                <div key={k} className="grid gap-1.5">
                  <Label htmlFor={`brand-${k}`}>
                    {k === 'termsUrl' ? 'Terms of use' : 'Privacy policy'}
                  </Label>
                  <Input
                    id={`brand-${k}`}
                    value={form.legal[k]}
                    placeholder="https://…"
                    onChange={(e) => set('legal', { ...form.legal, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </CollapsibleSection>
        ) : null}
      </div>

      <div className="grid content-start gap-3 xl:sticky xl:top-24">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Preview"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'app', label: 'App' },
              { value: 'signin', label: 'Sign-in' },
              { value: 'email', label: 'Email' },
            ]}
          />
          <Segmented
            label="Preview colours"
            value={scheme}
            onChange={setScheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        {tab === 'email' ? (
          emailHtml ? (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={emailHtml}
              className="h-[34rem] w-full rounded-card border border-line bg-surface"
            />
          ) : (
            <Skeleton className="h-[34rem]" />
          )
        ) : (
          <Mock tab={tab} data={form} scheme={scheme} accent={accent} />
        )}
        <p className="text-xs text-faint">
          The preview shows your unsaved edits. Nothing changes for anyone until you publish.
        </p>
      </div>
    </div>
  );
}

/** App and sign-in mock-ups, drawn with the real tokens but the draft's colours, in either mode. */
function Mock({
  tab,
  data,
  scheme,
  accent,
}: {
  tab: Tab;
  data: BrandData;
  scheme: 'light' | 'dark';
  accent: string;
}) {
  const vars = { ...SURFACES[scheme], ...themeVars(data.theme)[scheme] } as Record<string, string>;
  const pair = fontPair(data.fonts.pairId);
  return (
    <div
      className="h-[34rem] overflow-hidden rounded-card border border-line"
      style={
        {
          ...vars,
          background: 'var(--bg)',
          color: 'var(--text)',
          fontFamily: `'${pair.body}', system-ui`,
        } as React.CSSProperties
      }
    >
      {tab === 'app' ? (
        <div className="grid h-full grid-cols-[11rem_1fr]">
          <aside
            className="grid content-start gap-2 p-4"
            style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
          >
            <div className="mb-3 flex items-center gap-2">
              <span
                className="grid h-9 w-9 place-items-center rounded-full font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              >
                {data.displayName.charAt(0).toUpperCase()}
              </span>
              <span
                className="truncate text-lg"
                style={{ fontFamily: `'${pair.heading}', system-ui` }}
              >
                {data.displayName}
              </span>
            </div>
            {['People', 'Letters', 'Audit log'].map((n, i) => (
              <span
                key={n}
                className="rounded-full px-3 py-2 text-sm"
                style={
                  i === 0
                    ? { background: 'var(--accent-lo)', color: 'var(--accent-hi)' }
                    : { color: 'var(--text-muted)' }
                }
              >
                {n}
              </span>
            ))}
          </aside>
          <main className="grid content-start gap-4 p-6">
            <h3 className="text-2xl" style={{ fontFamily: `'${pair.heading}', system-ui` }}>
              People
            </h3>
            <div
              className="grid gap-3 rounded-3xl p-5"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {SAMPLE}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="rounded-full px-5 py-2 text-sm font-medium"
                  style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                >
                  Add a person
                </span>
                <span
                  className="rounded-full px-4 py-2 text-sm"
                  style={{ border: '1px solid var(--accent)', color: 'var(--accent-hi)' }}
                >
                  Import
                </span>
                <span
                  className="rounded-full px-3 py-1 text-xs"
                  style={{ background: 'var(--accent-lo)', color: 'var(--accent-hi)' }}
                >
                  Active
                </span>
              </div>
            </div>
            <div
              className="h-10 rounded-full px-5 text-sm leading-10"
              style={{
                background: 'var(--surface)',
                border: `1px solid ${accent}`,
                color: 'var(--text-muted)',
              }}
            >
              Search people
            </div>
          </main>
        </div>
      ) : (
        <div className="grid h-full grid-cols-[1.05fr_1fr]">
          <aside
            className="flex flex-col justify-between p-6"
            style={{ background: 'var(--deep)', color: 'var(--on-deep)' }}
          >
            <span className="text-xl" style={{ fontFamily: `'${pair.heading}', system-ui` }}>
              {data.displayName}
            </span>
            <div>
              <h3
                className="text-3xl font-light leading-tight"
                style={{ fontFamily: `'${pair.heading}', system-ui` }}
              >
                {data.signIn.headline || 'Your headline'}
              </h3>
              <ul className="mt-5 grid gap-2">
                {data.signIn.bullets.map((b, i) => (
                  <li
                    key={i}
                    className="rounded-full px-4 py-2 text-xs"
                    style={{ background: 'rgb(255 255 255 / 0.12)' }}
                  >
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <span className="text-xs opacity-60">© {data.displayName}</span>
          </aside>
          <main className="grid place-items-center p-6">
            <div className="grid w-full max-w-60 gap-3">
              <h4 className="text-xl" style={{ fontFamily: `'${pair.heading}', system-ui` }}>
                Sign in
              </h4>
              <div
                className="h-10 rounded-full px-4 text-sm leading-10"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                }}
              >
                Email
              </div>
              <div
                className="h-10 rounded-full px-4 text-sm leading-10"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                }}
              >
                Password
              </div>
              <span
                className="rounded-full py-2.5 text-center text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              >
                Sign in
              </span>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
