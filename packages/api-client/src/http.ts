import type { ZodType } from 'zod';

/** A non-2xx answer from the API. `message` is already readable; `details` holds field problems. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
    /** A machine-readable reason some endpoints add, such as STEP_UP_REQUIRED. */
    readonly code?: string,
    /** The server's reference for this request; quote it to support (D-67). */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API answered successfully but not in the shape the shared schema promises. */
export class ContractError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string[],
  ) {
    super(`Unexpected response from ${path}: ${issues.join('; ')}`);
    this.name = 'ContractError';
  }
}

export interface HttpOptions {
  /** e.g. https://api.flourishive.in or http://localhost:3000 (no trailing /v1) */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Sent as X-Client: native so the refresh token comes back in the body, not a cookie. */
  native?: boolean;
  /** Where to POST for a new access token when a request gets 401. */
  refreshPath: string;
  /** Called when refreshing fails: the person has to sign in again. */
  onSessionExpired?: () => void;
  /**
   * Called when the API asks the person to confirm it is them (STEP_UP_REQUIRED). Resolve true once
   * they have confirmed and the request is retried, or false if they cancelled.
   */
  onStepUp?: () => Promise<boolean>;
}

export interface RequestOptions<T> {
  query?: object;
  json?: unknown;
  body?: BodyInit;
  contentType?: string;
  schema?: ZodType<T>;
  /** false for sign-in style calls that must not carry a token or trigger a refresh. */
  auth?: boolean;
}

function queryString(query?: object): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Shared transport. The access token lives in memory only (never localStorage); the
 * refresh token is an httpOnly cookie in browsers. A 401 triggers exactly one refresh
 * that every concurrent request waits for, then the original request is retried once.
 */
export class Http {
  private token: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private readonly doFetch: typeof fetch;
  nativeRefreshToken: string | null = null;

  constructor(private readonly opts: HttpOptions) {
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
  }

  get accessToken() {
    return this.token;
  }
  setAccessToken(token: string | null) {
    this.token = token;
  }

  async request<T = void>(method: string, path: string, o: RequestOptions<T> = {}): Promise<T> {
    let res = await this.send(method, path, o);
    if (res.status === 401 && o.auth !== false && (await this.refresh()))
      res = await this.send(method, path, o);
    if (res.status === 403 && o.auth !== false && this.opts.onStepUp) {
      const code = await res
        .clone()
        .json()
        .then((b: { code?: string }) => b.code)
        .catch(() => undefined);
      if (code === 'STEP_UP_REQUIRED' && (await this.opts.onStepUp()))
        res = await this.send(method, path, o);
    }
    return this.read(path, res, o.schema);
  }

  private send(method: string, path: string, o: RequestOptions<unknown>): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.opts.native) headers['X-Client'] = 'native';
    if (this.token && o.auth !== false) headers.Authorization = `Bearer ${this.token}`;
    let body: BodyInit | undefined = o.body;
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.json);
    } else if (o.contentType) headers['Content-Type'] = o.contentType;
    return this.doFetch(`${this.opts.baseUrl}/v1${path}${queryString(o.query)}`, {
      method,
      headers,
      body,
      credentials: 'include',
    });
  }

  /**
   * Single-flight refresh. Resolves true when a new access token is in place.
   * `silent` is for the attempt made on page load: having no session yet is normal there,
   * so it must not trigger onSessionExpired (that would bounce visitors off emailed links).
   */
  refresh(o: { silent?: boolean } = {}): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const res = await this.doFetch(`${this.opts.baseUrl}/v1${this.opts.refreshPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.opts.native ? { 'X-Client': 'native' } : {}),
          },
          body: JSON.stringify(
            this.opts.native && this.nativeRefreshToken
              ? { refreshToken: this.nativeRefreshToken }
              : {},
          ),
          credentials: 'include',
        });
        if (!res.ok) throw new Error('refresh refused');
        const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
        if (!data.accessToken) throw new Error('no token');
        this.token = data.accessToken;
        if (data.refreshToken) this.nativeRefreshToken = data.refreshToken;
        return true;
      } catch {
        this.token = null;
        this.nativeRefreshToken = null;
        if (!o.silent) this.opts.onSessionExpired?.();
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async read<T>(path: string, res: Response, schema?: ZodType<T>): Promise<T> {
    if (!res.ok) {
      let message = res.statusText || `Request failed (${res.status})`;
      let details: string[] = [];
      let code: string | undefined;
      let requestId = res.headers.get('x-request-id') ?? undefined;
      try {
        const body = (await res.json()) as {
          message?: string | string[];
          code?: string;
          requestId?: string;
        };
        code = body.code;
        requestId = body.requestId ?? requestId;
        if (Array.isArray(body.message)) {
          details = body.message;
          message = body.message[0] ?? message;
        } else if (body.message) message = body.message;
      } catch {
        // not JSON; keep the status text
      }
      throw new ApiError(res.status, message, details, code, requestId);
    }
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ContractError(
        path,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    return parsed.data;
  }
}
