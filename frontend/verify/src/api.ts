import {
  acceptInfo,
  compareResult,
  verifyResult,
  type AcceptInfo,
  type CompareResult,
  type VerifyResult,
} from '@flourishive/schemas';
import { brand } from '@flourishive/ui';
import type { ZodType } from 'zod';

export class ApiProblem extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, schema: ZodType<T> | null, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${brand.apiUrl.replace(/\/$/, '')}/v1/public${path}`, init);
  } catch {
    throw new ApiProblem(0, 'Could not reach the server. Check your connection and try again.');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const m = (body as { message?: string | string[] } | null)?.message;
    throw new ApiProblem(
      res.status,
      (Array.isArray(m) ? m.join(' ') : m) || 'Something went wrong. Please try again.',
    );
  }
  if (!schema) return body as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiProblem(502, 'The server sent an unexpected answer.');
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const verifyApi = {
  byToken: (token: string): Promise<VerifyResult> =>
    request(`/verify/${encodeURIComponent(token)}`, verifyResult),
  lookup: (company: string, reference: string): Promise<VerifyResult> =>
    request(`/verify/lookup?${new URLSearchParams({ company, reference })}`, verifyResult),
  compare: (token: string, file: File): Promise<CompareResult> =>
    request(`/verify/${encodeURIComponent(token)}/compare`, compareResult, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    }),
};

export const acceptApi = {
  info: (token: string): Promise<AcceptInfo> =>
    request(`/accept/${encodeURIComponent(token)}`, acceptInfo),
  sendCode: (token: string) =>
    request<{ sent: boolean; expiresInMinutes: number; emailHint: string }>(
      `/accept/${encodeURIComponent(token)}/code`,
      null,
      { method: 'POST' },
    ),
  confirm: (token: string, code: string) =>
    request<{ accepted: boolean }>(
      `/accept/${encodeURIComponent(token)}/confirm`,
      null,
      json({ code, consent: true }),
    ),
  decline: (token: string, reason: string) =>
    request<{ declined: boolean }>(
      `/accept/${encodeURIComponent(token)}/decline`,
      null,
      json({ reason: reason || undefined }),
    ),
  documentUrl: (token: string) =>
    `${brand.apiUrl.replace(/\/$/, '')}/v1/public/accept/${encodeURIComponent(token)}/document`,
};
