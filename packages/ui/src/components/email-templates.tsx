import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { EmptyState } from './empty-state.tsx';
import { Input } from './input.tsx';
import { SearchBox } from './search-box.tsx';
import { Segmented } from './segmented.tsx';
import { Skeleton } from './skeleton.tsx';
import { Switch } from './switch.tsx';

export interface TemplateListEntry {
  event: string;
  label: string;
  description: string;
  source: 'company' | 'platform' | 'default';
  locked: boolean;
  readOnly: boolean;
}
export interface TemplateDetail extends TemplateListEntry {
  subject: string;
  body: string;
  defaultSubject: string;
  defaultBody: string;
  variables: { name: string; description: string; sample: string }[];
  required: string[];
}
export interface TemplatePreview {
  subject: string;
  html: string;
  text: string;
  problems: string[];
}

export interface EmailTemplatesApi {
  list: () => Promise<{ items: TemplateListEntry[] }>;
  get: (event: string) => Promise<TemplateDetail>;
  save: (
    event: string,
    input: { subject: string; body: string; locked?: boolean },
  ) => Promise<TemplateDetail>;
  reset: (event: string) => Promise<TemplateDetail>;
  preview: (
    event: string,
    input: { subject: string; body: string; scheme: 'light' | 'dark' },
  ) => Promise<TemplatePreview>;
  test: (event: string, input: { subject: string; body: string }) => Promise<void>;
}

const SOURCE_TEXT = {
  company: ['Your wording', 'accent'],
  platform: ['Platform wording', 'neutral'],
  default: ['Built-in wording', 'neutral'],
} as const;

/**
 * Reword the emails the system sends (D-59): the list on the left, the editor with a placeholder picker
 * and a live preview (light and dark) on the right. Shared by the company app and the admin console, which
 * can also lock an email so companies cannot reword it.
 */
export function EmailTemplates({
  api,
  canLock = false,
  onError,
  onNotice,
}: {
  api: EmailTemplatesApi;
  /** Platform console: show the "companies may not change this" switch. */
  canLock?: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<TemplateListEntry[] | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string | null>(null);

  const loadList = async () => {
    try {
      const r = await api.list();
      setItems(r.items);
      setActive((a) => a ?? r.items[0]?.event ?? null);
    } catch (e) {
      onError((e as Error).message);
      setItems([]);
    }
  };
  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items ?? []).filter(
      (i) => !t || `${i.label} ${i.description}`.toLowerCase().includes(t),
    );
  }, [items, q]);

  if (!items)
    return (
      <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );

  return (
    <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
      <aside className="grid content-start gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Find an email" label="Find an email" />
        <ul className="grid gap-1" aria-label="Emails">
          {shown.map((i) => (
            <li key={i.event}>
              <button
                type="button"
                onClick={() => setActive(i.event)}
                aria-current={active === i.event}
                className={`w-full rounded-card border px-4 py-3 text-left transition-colors ${
                  active === i.event
                    ? 'border-accent bg-accent-lo'
                    : 'border-line hover:border-line-strong'
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {i.label}
                  {i.locked ? <Badge tone="warning">Locked</Badge> : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{SOURCE_TEXT[i.source][0]}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-muted">No email matches “{q}”.</li>
          ) : null}
        </ul>
      </aside>
      <div>
        {active ? (
          <Editor
            key={active}
            event={active}
            api={api}
            canLock={canLock}
            onError={onError}
            onNotice={onNotice}
            onChanged={loadList}
          />
        ) : (
          <EmptyState title="No emails" description="There is nothing to reword yet." />
        )}
      </div>
    </div>
  );
}

function Editor({
  event,
  api,
  canLock,
  onError,
  onNotice,
  onChanged,
}: {
  event: string;
  api: EmailTemplatesApi;
  canLock: boolean;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<TemplateDetail | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [locked, setLocked] = useState(false);
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<'subject' | 'body'>('body');

  const apply = (d: TemplateDetail) => {
    setSaved(d);
    setSubject(d.subject);
    setBody(d.body);
    setLocked(d.locked);
  };
  useEffect(() => {
    let live = true;
    api
      .get(event)
      .then((d) => live && apply(d))
      .catch((e: Error) => onError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  // Live preview, a moment after typing stops.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => {
      api
        .preview(event, { subject, body, scheme })
        .then((p) => {
          setPreview(p);
          setProblems(p.problems);
        })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, scheme, saved?.event]);

  if (!saved) return <Skeleton className="h-96" />;

  const readOnly = saved.readOnly;
  const dirty =
    subject !== saved.subject || body !== saved.body || (canLock && locked !== saved.locked);

  const insert = (name: string) => {
    const token = `{{${name}}}`;
    const field = lastField.current === 'subject' ? subjectRef.current : bodyRef.current;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const next = field.value.slice(0, start) + token + field.value.slice(end);
    if (field === subjectRef.current) setSubject(next);
    else setBody(next);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    try {
      apply(await api.save(event, { subject, body, ...(canLock ? { locked } : {}) }));
      onNotice('Saved');
      await onChanged();
    } catch (e) {
      const m = (e as Error).message;
      setProblems(m.split('; '));
      onError(m);
    }
  };
  const reset = async () => {
    try {
      apply(await api.reset(event));
      onNotice('Back to the default wording');
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const test = async () => {
    try {
      await api.test(event, { subject, body });
      onNotice('A test email is on its way to you');
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const [sourceText, sourceTone] = SOURCE_TEXT[saved.source];

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-medium">{saved.label}</h2>
          <p className="mt-1 text-sm text-muted">{saved.description}</p>
        </div>
        <Badge tone={sourceTone}>{sourceText}</Badge>
      </header>

      {readOnly ? (
        <p className="rounded-card border border-line bg-surface-2 p-4 text-sm text-muted">
          The platform team has set the wording of this email, so it cannot be changed here. You can
          still preview it and send yourself a test.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="tpl-subject" className="pl-1 text-[13px] font-medium text-muted">
              Subject
            </label>
            <Input
              id="tpl-subject"
              ref={subjectRef}
              value={subject}
              disabled={readOnly}
              onFocus={() => (lastField.current = 'subject')}
              onChange={(e) => setSubject(e.target.value)}
              aria-invalid={problems.length > 0 || undefined}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="tpl-body" className="pl-1 text-[13px] font-medium text-muted">
              Message
            </label>
            <textarea
              id="tpl-body"
              ref={bodyRef}
              value={body}
              disabled={readOnly}
              rows={12}
              onFocus={() => (lastField.current = 'body')}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={problems.length > 0 || undefined}
              className="w-full rounded-card border border-line-strong bg-surface px-4 py-3 font-mono text-sm text-fg transition-[border-color,box-shadow] hover:border-accent/60 focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)] disabled:opacity-50 aria-[invalid=true]:border-danger"
            />
            <p className="pl-1 text-xs text-faint">
              Blank line = new paragraph. **bold**, [link text](https://…), and a button on its own
              line: [[Button text|{'{{link}}'}]]
            </p>
          </div>

          {!readOnly ? (
            <div className="grid gap-2">
              <span className="pl-1 text-[13px] font-medium text-muted">
                Click to add a placeholder
              </span>
              <div className="flex flex-wrap gap-2">
                {saved.variables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => insert(v.name)}
                    title={`${v.description}. Example: ${v.sample || '(empty)'}`}
                    className="rounded-pill border border-line-strong bg-surface px-3 py-1 font-mono text-xs transition-colors hover:border-accent hover:bg-accent-lo"
                  >
                    {`{{${v.name}}}`}
                    {saved.required.includes(v.name) ? ' *' : ''}
                  </button>
                ))}
              </div>
              <p className="pl-1 text-xs text-faint">* must stay in the email.</p>
            </div>
          ) : null}

          {problems.length > 0 ? (
            <ul
              role="alert"
              className="grid gap-1 rounded-card border border-danger/40 bg-danger-lo p-3 text-sm text-danger"
            >
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}

          {canLock ? (
            <div className="flex items-center justify-between gap-4 rounded-card border border-line p-4">
              <div>
                <p className="text-sm font-medium">Companies may not change this email</p>
                <p className="text-xs text-muted">
                  Locked emails use the platform wording above for every company.
                </p>
              </div>
              <Switch checked={locked} onChange={setLocked} label="Lock this email" />
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="pl-1 text-[13px] font-medium text-muted">Preview</span>
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
          <p className="truncate pl-1 text-sm">
            <span className="text-muted">Subject: </span>
            {preview?.subject ?? ''}
          </p>
          {preview ? (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-[28rem] w-full rounded-card border border-line bg-surface"
            />
          ) : (
            <Skeleton className="h-[28rem]" />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly ? (
          <Button onClick={save} disabled={!dirty || problems.length > 0}>
            Save
          </Button>
        ) : null}
        <Button variant="secondary" onClick={test} disabled={problems.length > 0}>
          Send me a test
        </Button>
        {!readOnly && saved.source !== 'default' ? (
          <Button variant="ghost" onClick={reset}>
            Reset to default
          </Button>
        ) : null}
        {dirty && !readOnly ? <span className="text-xs text-muted">Unsaved changes</span> : null}
      </div>
    </div>
  );
}
