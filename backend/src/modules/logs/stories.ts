import { createHash } from 'node:crypto';

/**
 * Turns an error into something a person can act on (D-67). Pure functions, so they are tested without
 * a server. Known failures have a template; anything else gets a plain generic account.
 */

export interface ErrorFacts {
  /** `ENOTFOUND`, `P2002`, an error class name, ... */
  code: string;
  /** What the failing thing said, trimmed and free of secrets. */
  message: string;
  /** A host named in the message, if any. */
  host?: string;
}

const HOST =
  /(?:getaddrinfo\s+\w+\s+|connect\s+\w+\s+|to\s+)([a-z0-9.-]+\.[a-z]{2,})/i;

/** Reads the useful facts out of whatever was thrown. Never returns a stack, a value or a secret. */
export function classifyError(err: unknown): ErrorFacts {
  const e = (err ?? {}) as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    hostname?: unknown;
    meta?: unknown;
  };
  const raw = err instanceof Error ? err.message : (e.message ?? err);
  const message = (typeof raw === 'string' ? raw : '')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  const rawCode =
    typeof e.code === 'string' && e.code
      ? e.code
      : typeof e.name === 'string' && e.name && e.name !== 'Error'
        ? e.name
        : 'UNEXPECTED';
  const host =
    typeof e.hostname === 'string'
      ? e.hostname
      : (HOST.exec(message)?.[1] ?? undefined);
  return { code: rawCode.slice(0, 60), message, host };
}

/** What happened and what to do, by error code. `{host}` is filled in when known. */
const KNOWN: Array<{
  match: (f: ErrorFacts) => boolean;
  what: string;
  todo: string;
}> = [
  {
    match: (f) => ['ENOTFOUND', 'EAI_AGAIN', 'EDNS'].includes(f.code),
    what: 'The server could not find {host} on the internet',
    todo: 'Check that the address in Integrations is spelled correctly, then try again. If it is, the other service may be down',
  },
  {
    match: (f) =>
      ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED'].includes(f.code),
    what: 'The server could not reach {host} in time',
    todo: 'Try again in a few minutes. If it keeps failing, check Integrations for the address',
  },
  {
    match: (f) => ['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(f.code),
    what: 'The connection to {host} was refused or dropped',
    todo: 'The other service may be restarting. Try again in a few minutes',
  },
  {
    match: (f) => f.code === 'EAUTH' || f.code === 'EENVELOPE',
    what: 'The mail server refused the login or the address',
    todo: 'Check the email sender and its password in Integrations, then send a test email',
  },
  {
    match: (f) => /^P10(01|02|08|17)$/.test(f.code),
    what: 'The server could not reach its database',
    todo: 'This needs the technical team. Nothing was saved. Try again shortly',
  },
  {
    match: (f) => f.code === 'P2024',
    what: 'The database was too busy to answer in time',
    todo: 'Try again in a minute. If it keeps happening, the server needs more capacity',
  },
  {
    match: (f) => f.code === 'P2002',
    what: 'The server tried to save something that already exists',
    todo: 'Check for a duplicate (for example the same email or number) and try again',
  },
  {
    match: (f) => f.code === 'P2025',
    what: 'The server looked for a record that is no longer there',
    todo: 'Refresh the page. Someone may have deleted it',
  },
  {
    match: (f) =>
      f.code === 'MaxRetriesPerRequestError' || /redis/i.test(f.message),
    what: 'The server could not reach its cache and queue service (Redis)',
    todo: 'This needs the technical team. Sign-in and background work may be affected',
  },
  {
    match: (f) => f.code === 'ENOSPC',
    what: 'The server ran out of disk space',
    todo: 'This needs the technical team right away. Nothing new can be saved',
  },
  {
    match: (f) =>
      [
        'NoSuchBucket',
        'AccessDenied',
        'InvalidAccessKeyId',
        'SignatureDoesNotMatch',
        'CredentialsProviderError',
      ].includes(f.code),
    what: 'File storage refused the request',
    todo: 'Check the file storage keys in Integrations, then run the storage check',
  },
  {
    match: (f) => /unsupported image format|Input buffer/i.test(f.message),
    what: 'An uploaded picture could not be read',
    todo: 'Ask for the picture again as a PNG, JPEG or WebP file',
  },
  {
    match: (f) => /No handler registered/i.test(f.message),
    what: 'A background job had no program to run it',
    todo: 'This is a bug. Share the reference with the technical team',
  },
];

const FRIENDLY_ROUTES: Array<[RegExp, string]> = [
  [/^POST \/auth\/login/, 'tried to sign in'],
  [/^POST \/documents\/bulk\/:id\/deliver/, 'sent a bulk batch of letters'],
  [/^POST \/documents\/:id\/deliver/, 'sent a letter'],
  [/^POST \/documents\/:id\/(sign|esign)/, 'signed a letter'],
  [/^POST \/documents\/:id\/send/, 'sent a letter for signature'],
  [/^POST \/documents/, 'created a letter'],
  [/^(GET|POST) \/documents/, 'opened letters'],
  [/^POST \/files/, 'uploaded a file'],
  [/^GET \/files/, 'opened a file'],
  [/^POST \/people\/import/, 'imported people from a file'],
  [/^(POST|PUT|PATCH) \/people/, 'saved a person'],
  [/^(POST|PUT|PATCH|DELETE) \/mail/, 'changed email settings'],
  [/^(POST|PUT|PATCH|DELETE) \/brand/, 'changed the brand'],
  [/^(POST|PUT|PATCH|DELETE) \/settings/, 'changed a setting'],
  [/^POST \/mfa/, 'set up two-step sign-in'],
];

function describeAction(method: string, route: string | null): string {
  if (!route) return 'was using the app';
  const key = `${method} ${route.replace(/^\/v\d+\//, '/')}`;
  for (const [re, phrase] of FRIENDLY_ROUTES) if (re.test(key)) return phrase;
  return `made a ${method} request to ${route}`;
}

export interface StoryInput extends ErrorFacts {
  /** For example "Asha (HR admin, Flourisense)". Null when the request was not signed in. */
  who: string | null;
  method: string | null;
  route: string | null;
}

/** One or two sentences: who did what, what the server could not do, what to try. */
export function buildStory(i: StoryInput): string {
  const known = KNOWN.find((k) => k.match(i));
  const host = i.host ?? 'another service';
  const subject = i.who ?? 'Someone';
  const action =
    i.method || i.route
      ? describeAction(i.method ?? 'GET', i.route)
      : 'was using the app';
  const lead = `${subject} ${action}.`;
  if (known)
    return `${lead} ${known.what.replace('{host}', host)} and stopped. ${known.todo}.`;
  return `${lead} Something unexpected went wrong on the server and it stopped. Nothing was lost that was not already saved. Try again; if it keeps failing, share the reference with the technical team.`;
}

/**
 * Groups the same fault together: the error type plus where it was thrown, without line numbers
 * (they change with every deploy) and without anything the error said (it can hold ids).
 */
export function fingerprint(err: unknown, route: string | null): string {
  const f = classifyError(err);
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  const frame =
    stack
      .split('\n')
      .slice(1)
      .find((l) => /\/(src|dist)\//.test(l) && !/node_modules/.test(l)) ?? '';
  const where = frame
    .replace(/^\s*at\s+/, '')
    .replace(/:\d+:\d+\)?$/, '')
    .replace(/^.*\/(src|dist)\//, '$1/')
    .trim();
  return createHash('sha1')
    .update(`${f.code}|${where || route || ''}`)
    .digest('hex');
}

/** Removes things that must not leave the server in an error report. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})\b/g, '[token]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[hex]');
}
