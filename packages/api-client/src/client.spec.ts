import { describe, expect, it, vi } from 'vitest';
import { ApiError, ContractError, createApiClient, createPlatformClient } from './index.js';

type Call = { url: string; init: RequestInit };
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A fake fetch that answers from a queue and records what was asked. */
function fake(...answers: (Response | ((c: Call) => Response))[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${call.url}`);
    return typeof next === 'function' ? next(call) : next;
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)?.[name];

const ME = {
  id: 'u1',
  tenantId: 't1',
  email: 'a@b.test',
  mfaEnabled: true,
  mfaRequired: true,
  permissions: ['self.read'],
};
const OK = { status: 'ok', accessToken: 'tok-1', expiresIn: 900 };

describe('sign-in and tokens', () => {
  it('keeps the access token after sign-in and sends it as a bearer', async () => {
    const f = fake(json(200, OK), json(200, ME));
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    const r = await api.auth.login({ tenant: 'acme', email: 'a@b.test', password: 'pw' });
    expect(r.status).toBe('ok');
    expect(api.isSignedIn()).toBe(true);
    expect((await api.auth.me()).email).toBe('a@b.test');
    expect(f.calls[0]!.url).toBe('http://api.test/v1/auth/login');
    expect(header(f.calls[0]!, 'Authorization')).toBeUndefined(); // no token on sign-in
    expect(header(f.calls[1]!, 'Authorization')).toBe('Bearer tok-1');
    expect(f.calls[1]!.init.credentials).toBe('include'); // cookie for refresh
  });

  it('does not store a token while MFA is still pending', async () => {
    const f = fake(
      json(200, { status: 'mfa_required', mfaToken: 'm1' }),
      json(200, { ...OK, accessToken: 'tok-2' }),
    );
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    const r = await api.auth.login({ tenant: 'acme', email: 'a@b.test', password: 'pw' });
    expect(r).toEqual({ status: 'mfa_required', mfaToken: 'm1' });
    expect(api.isSignedIn()).toBe(false);
    await api.auth.mfaVerify({ mfaToken: 'm1', code: '123456' });
    expect(api.isSignedIn()).toBe(true);
  });

  it('forgets the token on sign-out', async () => {
    const f = fake(json(200, OK), json(204));
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await api.auth.logout();
    expect(api.isSignedIn()).toBe(false);
  });
});

describe('refresh on 401', () => {
  it('refreshes once and retries the request with the new token', async () => {
    const f = fake(
      json(200, OK),
      json(401, { message: 'expired' }),
      json(200, { ...OK, accessToken: 'tok-2' }),
      json(200, ME),
    );
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    expect((await api.auth.me()).id).toBe('u1');
    expect(f.calls[2]!.url).toBe('http://api.test/v1/auth/refresh');
    expect(header(f.calls[3]!, 'Authorization')).toBe('Bearer tok-2');
  });

  it('shares one refresh between requests that fail together', async () => {
    const f = fake(
      json(200, OK),
      json(401, {}),
      json(401, {}),
      json(200, { ...OK, accessToken: 'tok-2' }),
      json(200, ME),
      json(200, { total: 0, page: 1, pageSize: 25, items: [] }),
    );
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await Promise.all([api.auth.me(), api.people.list()]);
    expect(f.calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('signs the person out when the refresh is refused', async () => {
    const f = fake(json(200, OK), json(401, {}), json(401, { message: 'Session expired' }));
    const expired = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetch: f.fetch,
      onSessionExpired: expired,
    });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expect(api.isSignedIn()).toBe(false);
  });

  it('restoring a session on page load fails quietly when there is none', async () => {
    // A visitor opening an emailed reset link has no session; that must not look like an expiry.
    const f = fake(json(401, { message: 'Missing refresh token' }));
    const expired = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetch: f.fetch,
      onSessionExpired: expired,
    });
    expect(await api.restoreSession()).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it('does not try to refresh a failed sign-in', async () => {
    const f = fake(json(401, { message: 'Invalid credentials' }));
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await expect(
      api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'bad' }),
    ).rejects.toThrow('Invalid credentials');
    expect(f.calls).toHaveLength(1);
  });

  it('native clients send and rotate the refresh token in the body', async () => {
    const f = fake(
      json(200, { ...OK, refreshToken: 'r1' }),
      json(401, {}),
      json(200, { ...OK, accessToken: 'tok-2', refreshToken: 'r2' }),
      json(200, ME),
    );
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch, native: true });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await api.auth.me();
    expect(header(f.calls[0]!, 'X-Client')).toBe('native');
    expect(JSON.parse(String(f.calls[2]!.init.body))).toEqual({ refreshToken: 'r1' });
    expect(api.http.nativeRefreshToken).toBe('r2');
  });
});

describe('errors and contracts', () => {
  it('turns field errors into an ApiError with details', async () => {
    const f = fake(
      json(200, OK),
      json(400, {
        statusCode: 400,
        message: ['person.firstName: Too small', 'engagement.type: Invalid'],
      }),
    );
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    const err = await api.people.create({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.details).toHaveLength(2);
  });

  it('refuses a response that breaks the shared contract', async () => {
    const f = fake(json(200, OK), json(200, { id: 'u1' }));
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await expect(api.auth.me()).rejects.toBeInstanceOf(ContractError);
  });
});

describe('request shapes', () => {
  it('sends the CSV as text with a dry run by default', async () => {
    const result = {
      dryRun: true,
      totalRows: 1,
      valid: true,
      errors: [],
      willCreate: { people: 1, departments: [], designations: [], locations: [] },
      willUpdate: { people: 0 },
      committed: false,
    };
    const f = fake(
      json(200, OK),
      json(200, result),
      json(200, { ...result, dryRun: false, committed: true }),
    );
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await api.people.import('employee_code\nE1');
    await api.people.import('employee_code\nE1', { dryRun: false, createMissing: true });
    expect(f.calls[1]!.url).toBe(
      'http://api.test/v1/people/import?dryRun=true&createMissing=false',
    );
    expect(header(f.calls[1]!, 'Content-Type')).toBe('text/csv');
    expect(f.calls[1]!.init.body).toBe('employee_code\nE1');
    expect(f.calls[2]!.url).toContain('dryRun=false&createMissing=true');
  });

  it('builds list queries without empty values', async () => {
    const f = fake(json(200, OK), json(200, { total: 0, page: 1, pageSize: 25, items: [] }));
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await api.people.list({ q: 'asha', type: 'INTERN', departmentId: undefined, page: 2 });
    expect(f.calls[1]!.url).toBe('http://api.test/v1/people?q=asha&type=INTERN&page=2');
  });

  it('uploads a file with its own content type and name', async () => {
    const file = {
      id: 'f1',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      sha256: 'x',
      createdAt: 'now',
    };
    const f = fake(json(200, OK), json(201, file));
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login({ tenant: 'a', email: 'a@b.test', password: 'pw' });
    await api.files.upload(new Blob(['%PDF'], { type: 'application/pdf' }), 'offer letter.pdf');
    expect(f.calls[1]!.url).toBe('http://api.test/v1/files?name=offer+letter.pdf');
    expect(header(f.calls[1]!, 'Content-Type')).toBe('application/pdf');
  });
});

describe('platform client', () => {
  it('uses the platform endpoints for sign-in and refresh', async () => {
    const f = fake(
      json(200, { status: 'mfa_required', mfaToken: 'm' }),
      json(200, OK),
      json(401, {}),
      json(200, { ...OK, accessToken: 'tok-2' }),
      json(200, []),
    );
    const api = createPlatformClient({ baseUrl: 'http://api.test', fetch: f.fetch });
    await api.auth.login('root@x.test', 'pw');
    await api.auth.mfaVerify({ mfaToken: 'm', code: '123456' });
    await api.tenants.list();
    expect(f.calls[0]!.url).toBe('http://api.test/v1/platform/auth/login');
    expect(f.calls[3]!.url).toBe('http://api.test/v1/platform/auth/refresh');
  });
});
