import { PLACEHOLDER, type EmailEventDef } from './events.js';

export interface Brand {
  name: string;
  accent: string;
}
export const DEFAULT_BRAND: Omit<Brand, 'name'> = { accent: '#2a9158' };

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** A value can never carry a placeholder of its own, so nothing is substituted twice. */
const defang = (s: string): string => s.replaceAll('{{', '{ {');

const BUTTON = /^\[\[([^\]|]+)\|([^\]]+)\]\]$/;
const LINK = /\[([^\]|[]+)\]\(([^)\s]+)\)/g;
const BOLD = /\*\*(.+?)\*\*/g;
/** A link target must be a web address or a placeholder that becomes one. */
const SAFE_TARGET = /^(https?:\/\/[^\s]+|\{\{\s*[A-Za-z0-9_]+\s*\}\})$/;

/** Problems with a subject and body, in plain words. Empty means it can be saved. */
export function validateTemplate(
  def: EmailEventDef,
  subject: string,
  body: string,
): string[] {
  const problems: string[] = [];
  const allowed = new Set(def.variables.map((v) => v.name));
  const used = new Set<string>();
  for (const [where, text] of [
    ['subject', subject],
    ['body', body],
  ] as const) {
    for (const m of text.matchAll(PLACEHOLDER)) {
      const n = m[1]!;
      used.add(n);
      if (!allowed.has(n))
        problems.push(
          `{{${n}}} in the ${where} is not a placeholder this email has. You can use: ${[...allowed].map((a) => `{{${a}}}`).join(', ')}`,
        );
    }
    if (text.replace(PLACEHOLDER, '').match(/\{\{|\}\}/))
      problems.push(
        `The ${where} has a "{{" or "}}" that is not a complete placeholder such as {{${def.variables[0]?.name ?? 'name'}}}`,
      );
  }
  for (const r of def.required)
    if (!used.has(r))
      problems.push(
        `The email must keep {{${r}}}, or the recipient cannot use it`,
      );
  if (!subject.trim()) problems.push('The subject cannot be empty');
  if (!body.trim()) problems.push('The message cannot be empty');
  for (const m of body.matchAll(/\[\[[^\]|]+\|([^\]]+)\]\]/g))
    if (!SAFE_TARGET.test(m[1]!.trim()))
      problems.push(
        `A button must point to a web address (https://…) or a placeholder, not "${m[1]}"`,
      );
  for (const m of body.matchAll(LINK))
    if (!SAFE_TARGET.test(m[2]!))
      problems.push(
        `A link must point to a web address (https://…) or a placeholder, not "${m[2]}"`,
      );
  return [...new Set(problems)];
}

function fill(
  s: string,
  vars: Record<string, string>,
  escape: boolean,
): string {
  return s.replace(PLACEHOLDER, (_, n: string) => {
    const v = defang(vars[n] ?? '');
    return escape ? esc(v).replaceAll('\n', '<br>') : v;
  });
}

const safeHref = (url: string): string =>
  /^https?:\/\//i.test(url) ? esc(url) : '#';

function inlineHtml(
  raw: string,
  vars: Record<string, string>,
  accent: string,
): string {
  let s = esc(raw);
  s = s.replace(LINK, (_, t: string, u: string) => {
    const url = fill(u.replaceAll('&amp;', '&'), vars, false);
    return `<a href="${safeHref(url)}" style="color:${accent}">${t}</a>`;
  });
  s = s.replace(BOLD, '<strong>$1</strong>');
  return fill(s, vars, true).replaceAll('\n', '<br>');
}

function buttonHtml(
  label: string,
  target: string,
  vars: Record<string, string>,
  accent: string,
): string {
  const url = fill(target.trim(), vars, false);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="background:${accent};border-radius:8px"><a href="${safeHref(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;text-decoration:none">${fill(esc(label.trim()), vars, true)}</a></td></tr></table>`;
}

function layout(
  brand: Brand,
  inner: string,
  subject: string,
  scheme: 'auto' | 'light' | 'dark',
): string {
  const light = {
    page: '#f4f5f4',
    card: '#ffffff',
    text: '#1d2321',
    muted: '#6b7370',
  };
  const dark = {
    page: '#111514',
    card: '#1b201e',
    text: '#e8ece9',
    muted: '#98a29d',
  };
  const c = scheme === 'dark' ? dark : light;
  const auto =
    scheme === 'auto'
      ? `@media (prefers-color-scheme: dark){.page{background:${dark.page}!important}.card{background:${dark.card}!important;color:${dark.text}!important}.muted{color:${dark.muted}!important}}`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(subject)}</title><style>${auto}</style></head><body class="page" style="margin:0;padding:24px 12px;background:${c.page};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%"><tr><td style="padding:0 4px 14px;font-size:18px;font-weight:700;color:${brand.accent}">${esc(brand.name)}</td></tr><tr><td class="card" style="background:${c.card};color:${c.text};border-radius:12px;padding:28px;font-size:15px;line-height:1.6">${inner}</td></tr><tr><td class="muted" style="padding:14px 4px;font-size:12px;color:${c.muted}">Sent by ${esc(brand.name)}. Please do not reply to this message.</td></tr></table></td></tr></table></body></html>`;
}

/** Renders a subject and body with the given values into the branded layout and a plain-text copy. */
export function renderEmail(
  subject: string,
  body: string,
  vars: Record<string, string>,
  brand: Brand,
  scheme: 'auto' | 'light' | 'dark' = 'auto',
): RenderedMail {
  const blocks = body
    .replaceAll('\r\n', '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const html: string[] = [];
  const text: string[] = [];
  for (const b of blocks) {
    const btn = BUTTON.exec(b);
    if (btn) {
      html.push(buttonHtml(btn[1]!, btn[2]!, vars, brand.accent));
      text.push(
        `${fill(btn[1]!.trim(), vars, false)}: ${fill(btn[2]!.trim(), vars, false)}`,
      );
      continue;
    }
    // A block that is only an empty placeholder (for example an optional note) disappears.
    if (fill(b, vars, false).trim() === '') continue;
    html.push(
      `<p style="margin:0 0 16px">${inlineHtml(b, vars, brand.accent)}</p>`,
    );
    text.push(
      fill(
        b
          .replace(LINK, (_, t: string, u: string) => `${t} (${u})`)
          .replace(BOLD, '$1'),
        vars,
        false,
      ),
    );
  }
  const subj = fill(subject, vars, false)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return {
    subject: subj,
    text: text.join('\n\n'),
    html: layout(brand, html.join(''), subj, scheme),
  };
}
