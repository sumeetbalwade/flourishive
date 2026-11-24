import { Copy, Route } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  ErrorLogItem,
  ErrorLogResponse,
  JobLogResponse,
  RequestLogResponse,
  SigninLogResponse,
  TraceResponse,
} from '@flourishive/schemas';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { Dialog, DialogContent } from './dialog.tsx';
import { EmptyState } from './empty-state.tsx';
import { Input } from './input.tsx';
import { Segmented } from './segmented.tsx';
import { Select } from './select.tsx';
import { Skeleton } from './skeleton.tsx';
import { Table, TBody, TD, TH, THead, TR } from './table.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.tsx';
import { useToast } from './toast.tsx';

/** Filters live in the web address so a view can be shared; the host app keeps them there. */
export type LogParams = Record<string, string | undefined>;

export interface LogsApi {
  requests: (q: Record<string, unknown>) => Promise<RequestLogResponse>;
  errors: (q: Record<string, unknown>) => Promise<ErrorLogResponse>;
  signins: (q: Record<string, unknown>) => Promise<SigninLogResponse>;
  jobs?: (q: Record<string, unknown>) => Promise<JobLogResponse>;
  trace: (requestId: string) => Promise<TraceResponse>;
  copy: (requestId: string) => Promise<{ text: string }>;
}

export interface LogsViewProps {
  api: LogsApi;
  /** Platform staff see every company and the technical detail; a company sees its own, in plain words. */
  platform?: boolean;
  params: LogParams;
  onParams: (next: LogParams) => void;
  /** Extra tabs after the built-in ones, such as the email log. */
  extraTabs?: { id: string; label: string; content: ReactNode }[];
  readError: (e: unknown) => string;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-IN');

/** Loads once per key; shows loading and error states. */
function useLoad<T>(load: () => Promise<T>, key: string, readError: (e: unknown) => string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useCallback(load, [key]);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    stable().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ loading: false, error: readError(e) }),
    );
    return () => {
      live = false;
    };
  }, [stable, readError]);
  return state;
}

function Pager({
  page,
  pageSize,
  total,
  go,
}: {
  page: number;
  pageSize: number;
  total: number;
  go: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => go(page - 1)}>
        Newer
      </Button>
      Page {page} of {pages}
      <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => go(page + 1)}>
        Older
      </Button>
    </div>
  );
}

const TONE_DOT = { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-danger' } as const;

/** Everything that shares one request id, in time order. */
export function TraceDialog({
  api,
  requestId,
  onClose,
  readError,
}: {
  api: LogsApi;
  requestId: string | null;
  onClose: () => void;
  readError: (e: unknown) => string;
}) {
  const toast = useToast();
  const [state, setState] = useState<{ data?: TraceResponse; error?: string }>({});
  useEffect(() => {
    if (!requestId) return;
    let live = true;
    setState({});
    api.trace(requestId).then(
      (data) => live && setState({ data }),
      (e) => live && setState({ error: readError(e) }),
    );
    return () => {
      live = false;
    };
  }, [api, requestId, readError]);
  return (
    <Dialog open={requestId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="What happened to this request"
        description={requestId ? `Reference ${requestId}` : undefined}
        className="max-w-2xl"
      >
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : !state.data ? (
          <Skeleton className="h-32 w-full" />
        ) : state.data.entries.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing was found for this reference. Older entries are deleted after the retention
            period, and quick successful page loads are only sampled.
          </p>
        ) : (
          <ol className="space-y-3">
            {state.data.entries.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${TONE_DOT[e.tone]}`}
                />
                <div className="min-w-0">
                  <p className="text-sm text-fg">{e.title}</p>
                  {e.detail ? <p className="mt-0.5 text-sm text-muted">{e.detail}</p> : null}
                  <p className="text-xs text-faint">{when(e.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {requestId ? (
          <div className="mt-5 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  const { text } = await api.copy(requestId);
                  await navigator.clipboard.writeText(text);
                  toast({ title: 'Copied for support', tone: 'success' });
                } catch (e) {
                  toast({ title: readError(e), tone: 'danger' });
                }
              }}
            >
              <Copy size={14} /> Copy for support
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ErrorCard({
  e,
  platform,
  onTrace,
  api,
}: {
  e: ErrorLogItem;
  platform: boolean;
  onTrace: (id: string) => void;
  api: LogsApi;
}) {
  const toast = useToast();
  return (
    <li className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone="danger">{e.count === 1 ? 'Happened once' : `Happened ${e.count} times`}</Badge>
        {platform ? <Badge>{e.tenantName ?? 'Platform'}</Badge> : null}
        <span>First {when(e.firstSeen)}</span>
        <span>· Last {when(e.lastSeen)}</span>
      </div>
      <p className="mt-3 font-display text-lg leading-snug text-fg">{e.story}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {e.requestId ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => onTrace(e.requestId!)}>
              <Route size={14} /> Trace this request
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  const { text } = await api.copy(e.requestId!);
                  await navigator.clipboard.writeText(text);
                  toast({ title: 'Copied for support', tone: 'success' });
                } catch {
                  toast({ title: 'Could not copy', tone: 'danger' });
                }
              }}
            >
              <Copy size={14} /> Copy for support
            </Button>
          </>
        ) : null}
      </div>
      {platform ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Technical detail</summary>
          <dl className="mt-2 grid gap-1 text-xs text-muted">
            <div>
              <dt className="inline text-faint">Code: </dt>
              <dd className="inline font-mono">{e.errorCode}</dd>
            </div>
            {e.routePattern ? (
              <div>
                <dt className="inline text-faint">Route: </dt>
                <dd className="inline font-mono">{e.routePattern}</dd>
              </div>
            ) : null}
            {e.requestId ? (
              <div>
                <dt className="inline text-faint">Request id: </dt>
                <dd className="inline font-mono">{e.requestId}</dd>
              </div>
            ) : null}
            <div>
              <dt className="inline text-faint">Message: </dt>
              <dd className="inline font-mono">{e.message}</dd>
            </div>
          </dl>
          {e.stack ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded-card bg-surface-2 p-3 text-xs">
              {e.stack}
            </pre>
          ) : (
            <p className="mt-2 text-xs text-faint">
              Stack traces need the “See error details” permission.
            </p>
          )}
        </details>
      ) : null}
    </li>
  );
}

function Box({
  state,
  empty,
  children,
}: {
  state: { data?: unknown; error?: string; loading: boolean };
  empty: { title: string; description: string; isEmpty: boolean };
  children: ReactNode;
}) {
  if (state.error) return <EmptyState title="Could not load this" description={state.error} />;
  if (state.loading && !state.data) return <Skeleton className="h-64 w-full" />;
  if (empty.isEmpty) return <EmptyState title={empty.title} description={empty.description} />;
  return <div className={state.loading ? 'opacity-60 transition-opacity' : ''}>{children}</div>;
}

const pick = (p: LogParams, ...keys: string[]) =>
  Object.fromEntries(keys.filter((k) => p[k]).map((k) => [k, p[k]]));

function Filters({ children, total, unit }: { children: ReactNode; total?: number; unit: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      {children}
      {total !== undefined ? (
        <span className="ml-auto text-sm text-muted">
          {total} {unit}
        </span>
      ) : null}
    </div>
  );
}

function TextFilter({
  label,
  placeholder,
  value,
  onApply,
}: {
  label: string;
  placeholder: string;
  value?: string;
  onApply: (v?: string) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(text.trim() || undefined);
      }}
    >
      <Input
        aria-label={label}
        className="w-64"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

/**
 * Logs (D-67): Errors with plain-English stories, Activity, Sign-ins and (for staff) Jobs. Shared by the
 * company app and the admin console. Every filter is kept in the address by the host.
 */
export function LogsView({
  api,
  platform = false,
  params,
  onParams,
  extraTabs,
  readError,
}: LogsViewProps) {
  const tab = params.tab ?? 'errors';
  const page = Number(params.page ?? 1) || 1;
  const [trace, setTrace] = useState<string | null>(null);
  const set = (next: LogParams) => onParams({ ...params, page: undefined, ...next });
  const setTab = (t: string) => onParams({ tab: t });

  const errors = useLoad(
    () =>
      tab === 'errors'
        ? api.errors({ page, ...pick(params, 'q', 'requestId', 'route') })
        : Promise.resolve(undefined as never),
    `e|${tab}|${page}|${params.q}|${params.requestId}|${params.route}`,
    readError,
  );
  const requests = useLoad(
    () =>
      tab === 'activity'
        ? api.requests({ page, ...pick(params, 'status', 'method', 'route', 'requestId') })
        : Promise.resolve(undefined as never),
    `r|${tab}|${page}|${params.status}|${params.method}|${params.route}|${params.requestId}`,
    readError,
  );
  const signins = useLoad(
    () =>
      tab === 'signins'
        ? api.signins({ page, ...pick(params, 'outcome', 'q') })
        : Promise.resolve(undefined as never),
    `s|${tab}|${page}|${params.outcome}|${params.q}`,
    readError,
  );
  const jobs = useLoad(
    () =>
      tab === 'jobs' && api.jobs
        ? api.jobs({ page, ...pick(params, 'status', 'name') })
        : Promise.resolve(undefined as never),
    `j|${tab}|${page}|${params.status}|${params.name}`,
    readError,
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <TextFilter
          label="Find by reference"
          placeholder="Paste a reference from an error message"
          onApply={(v) => v && setTrace(v)}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="signins">Sign-ins</TabsTrigger>
          {platform && api.jobs ? <TabsTrigger value="jobs">Background jobs</TabsTrigger> : null}
          {extraTabs?.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="errors">
          <Filters total={errors.data?.total} unit="kinds of error">
            <TextFilter
              label="Search errors"
              placeholder="Search the wording"
              value={params.q}
              onApply={(q) => set({ q })}
            />
          </Filters>
          <Box
            state={errors}
            empty={{
              title: 'No errors',
              description:
                'When something goes wrong on the server it shows up here, in plain words.',
              isEmpty: !!errors.data && errors.data.items.length === 0,
            }}
          >
            <ul className="grid gap-4">
              {errors.data?.items.map((e) => (
                <ErrorCard key={e.id} e={e} platform={platform} onTrace={setTrace} api={api} />
              ))}
            </ul>
            {errors.data ? (
              <Pager {...errors.data} go={(p) => onParams({ ...params, page: String(p) })} />
            ) : null}
          </Box>
        </TabsContent>

        <TabsContent value="activity">
          <Filters total={requests.data?.total} unit="requests">
            <div className="w-44">
              <Select
                value={params.status ?? 'ALL'}
                onValueChange={(v) => set({ status: v === 'ALL' ? undefined : v })}
                options={[
                  { value: 'ALL', label: 'Any result' },
                  { value: '2xx', label: 'Worked (2xx)' },
                  { value: '4xx', label: 'Refused (4xx)' },
                  { value: '5xx', label: 'Failed (5xx)' },
                ]}
              />
            </div>
            <div className="w-36">
              <Select
                value={params.method ?? 'ALL'}
                onValueChange={(v) => set({ method: v === 'ALL' ? undefined : v })}
                options={[
                  { value: 'ALL', label: 'Any action' },
                  { value: 'GET', label: 'Reads' },
                  { value: 'POST', label: 'Adds' },
                  { value: 'PUT', label: 'Saves' },
                  { value: 'PATCH', label: 'Edits' },
                  { value: 'DELETE', label: 'Deletes' },
                ]}
              />
            </div>
            <TextFilter
              label="Filter by route"
              placeholder="Part of a route, e.g. /people"
              value={params.route}
              onApply={(route) => set({ route })}
            />
          </Filters>
          <Box
            state={requests}
            empty={{
              title: 'No activity yet',
              description:
                'Every change, every failure and every slow request is kept here. Quick successful page loads are only sampled.',
              isEmpty: !!requests.data && requests.data.items.length === 0,
            }}
          >
            <Table compact>
              <THead>
                <TR>
                  <TH>When</TH>
                  {platform ? <TH>Company</TH> : null}
                  <TH>Request</TH>
                  <TH>Result</TH>
                  <TH>Time</TH>
                  <TH>{''}</TH>
                </TR>
              </THead>
              <TBody>
                {requests.data?.items.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-xs">{when(r.createdAt)}</TD>
                    {platform ? <TD>{r.tenantName ?? '—'}</TD> : null}
                    <TD className="font-mono text-xs">
                      {r.method} {r.routePattern}
                    </TD>
                    <TD>
                      <Badge
                        tone={r.status >= 500 ? 'danger' : r.status >= 400 ? 'warning' : 'success'}
                      >
                        {r.status}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{r.durationMs} ms</TD>
                    <TD>
                      <Button size="sm" variant="ghost" onClick={() => setTrace(r.requestId)}>
                        Trace
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {requests.data ? (
              <Pager {...requests.data} go={(p) => onParams({ ...params, page: String(p) })} />
            ) : null}
          </Box>
        </TabsContent>

        <TabsContent value="signins">
          <Filters total={signins.data?.total} unit="sign-ins">
            <div className="w-52">
              <Select
                value={params.outcome ?? 'ALL'}
                onValueChange={(v) => set({ outcome: v === 'ALL' ? undefined : v })}
                options={[
                  { value: 'ALL', label: 'Any outcome' },
                  { value: 'SUCCESS', label: 'Signed in' },
                  { value: 'BAD_PASSWORD', label: 'Wrong password' },
                  { value: 'MFA_FAILED', label: 'Wrong code' },
                  { value: 'LOCKED', label: 'Locked out' },
                  { value: 'SUSPENDED', label: 'Account switched off' },
                  { value: 'MFA_OK', label: 'Two-step passed' },
                  { value: 'PASSKEY', label: 'Passkey' },
                  { value: 'TRUSTED_DEVICE', label: 'Remembered device' },
                ]}
              />
            </div>
            <TextFilter
              label="Find an address"
              placeholder="Type a full address"
              value={params.q}
              onApply={(q) => set({ q })}
            />
          </Filters>
          <Box
            state={signins}
            empty={{
              title: 'No sign-ins yet',
              description: 'Every sign-in attempt and how it ended is listed here.',
              isEmpty: !!signins.data && signins.data.items.length === 0,
            }}
          >
            <Table compact>
              <THead>
                <TR>
                  <TH>When</TH>
                  {platform ? <TH>Company</TH> : null}
                  <TH>Outcome</TH>
                  <TH>From</TH>
                  <TH>Device</TH>
                </TR>
              </THead>
              <TBody>
                {signins.data?.items.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-xs">{when(r.createdAt)}</TD>
                    {platform ? <TD>{r.tenantName ?? 'Platform staff'}</TD> : null}
                    <TD>
                      <Badge tone={OUTCOME[r.outcome][1]}>{OUTCOME[r.outcome][0]}</Badge>
                    </TD>
                    <TD className="font-mono text-xs">{r.ip ?? '—'}</TD>
                    <TD className="max-w-xs truncate text-xs text-muted" title={r.userAgent ?? ''}>
                      {r.userAgent ?? '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {signins.data ? (
              <Pager {...signins.data} go={(p) => onParams({ ...params, page: String(p) })} />
            ) : null}
          </Box>
        </TabsContent>

        {platform && api.jobs ? (
          <TabsContent value="jobs">
            <Filters total={jobs.data?.total} unit="jobs">
              <div className="w-44">
                <Select
                  value={params.status ?? 'ALL'}
                  onValueChange={(v) => set({ status: v === 'ALL' ? undefined : v })}
                  options={[
                    { value: 'ALL', label: 'Any state' },
                    { value: 'FAILED', label: 'Failed' },
                    { value: 'PENDING', label: 'Waiting' },
                    { value: 'DONE', label: 'Done' },
                  ]}
                />
              </div>
            </Filters>
            <Box
              state={jobs}
              empty={{
                title: 'No background jobs',
                description: 'Letters, emails and other queued work are listed here.',
                isEmpty: !!jobs.data && jobs.data.items.length === 0,
              }}
            >
              <Table compact>
                <THead>
                  <TR>
                    <TH>Started</TH>
                    <TH>Company</TH>
                    <TH>Job</TH>
                    <TH>State</TH>
                    <TH>Tries</TH>
                  </TR>
                </THead>
                <TBody>
                  {jobs.data?.items.map((j) => (
                    <TR key={j.id}>
                      <TD className="whitespace-nowrap text-xs">{when(j.createdAt)}</TD>
                      <TD>{j.tenantName ?? '—'}</TD>
                      <TD className="font-mono text-xs">{j.name}</TD>
                      <TD>
                        <Badge
                          tone={
                            j.status === 'FAILED'
                              ? 'danger'
                              : j.status === 'DONE'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {j.status === 'PENDING'
                            ? 'Waiting'
                            : j.status === 'DONE'
                              ? 'Done'
                              : 'Failed'}
                        </Badge>
                        {j.lastError ? (
                          <p className="mt-1 max-w-sm text-xs text-muted">{j.lastError}</p>
                        ) : null}
                      </TD>
                      <TD>{j.attempts}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {jobs.data ? (
                <Pager {...jobs.data} go={(p) => onParams({ ...params, page: String(p) })} />
              ) : null}
            </Box>
          </TabsContent>
        ) : null}

        {extraTabs?.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            {t.content}
          </TabsContent>
        ))}
      </Tabs>
      <TraceDialog
        api={api}
        requestId={trace}
        onClose={() => setTrace(null)}
        readError={readError}
      />
    </div>
  );
}

const OUTCOME = {
  SUCCESS: ['Signed in', 'success'],
  BAD_PASSWORD: ['Wrong password', 'warning'],
  LOCKED: ['Locked out', 'danger'],
  MFA_OK: ['Two-step passed', 'success'],
  MFA_FAILED: ['Wrong code', 'warning'],
  PASSKEY: ['Passkey', 'success'],
  TRUSTED_DEVICE: ['Remembered device', 'success'],
  SUSPENDED: ['Account switched off', 'danger'],
} as const;

// ---------------------------------------------------------------- alerts

export interface AlertRow {
  event: string;
  label: string;
  hint: string;
  delivery: 'INSTANT' | 'DIGEST' | 'OFF';
}

/** Which problems a person wants to hear about, and how (D-68). Opt-in: everything starts Off. */
export function AlertsCard({
  items,
  onChange,
  saving,
  dirty,
  onSave,
  onDiscard,
}: {
  items: AlertRow[];
  onChange: (event: string, delivery: AlertRow['delivery']) => void;
  saving: boolean;
  dirty: number;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <ul className="divide-y divide-line">
        {items.map((a) => (
          <li key={a.event} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0 max-w-md">
              <p className="text-sm font-medium text-fg">{a.label}</p>
              <p className="text-xs text-muted">{a.hint}</p>
            </div>
            <AlertChoice
              value={a.delivery}
              onChange={(d) => onChange(a.event, d)}
              label={a.label}
            />
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-line pt-5">
        {dirty > 0 ? (
          <span role="status" className="mr-auto text-sm text-warning">
            {dirty} unsaved {dirty === 1 ? 'change' : 'changes'}
          </span>
        ) : null}
        <Button variant="ghost" disabled={dirty === 0 || saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button loading={saving} disabled={dirty === 0} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

function AlertChoice({
  value,
  onChange,
  label,
}: {
  value: AlertRow['delivery'];
  onChange: (d: AlertRow['delivery']) => void;
  label: string;
}) {
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: 'INSTANT', label: 'Instant', title: 'An email right away, at most once an hour' },
        { value: 'DIGEST', label: 'Daily summary', title: 'One email each morning at 08:00' },
        { value: 'OFF', label: 'Off' },
      ]}
    />
  );
}
