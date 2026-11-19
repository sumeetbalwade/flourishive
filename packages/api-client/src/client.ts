import {
  auditListResponse,
  chainCheck,
  fileResponse,
  importResult,
  loginResponse,
  meResponse,
  mfaConfirmResponse,
  mfaSetupResponse,
  notificationItem,
  orgItem,
  peopleListResponse,
  engagementResponse,
  entityItem,
  roleResponse,
  settingsResponse,
  tenantRolePolicy,
  type MfaLevel,
  type TenantPolicyPatch,
  tokensResponse,
  type CreatePersonBody,
  type LoginBody,
  type OrgKind,
  type PeopleListQuery,
  type UpdatePersonBody,
} from '@flourishive/schemas';
import { z } from 'zod';
import { Http, type HttpOptions } from './http.js';

type Opts = Omit<HttpOptions, 'refreshPath'>;

/** Client for the tenant app (web, desktop, mobile). */
export function createApiClient(opts: Opts) {
  const http = new Http({ ...opts, refreshPath: '/auth/refresh' });

  /** Stores the access token when a sign-in step finishes the login. */
  const adopt = <R extends object>(r: R): R => {
    const t = r as { accessToken?: string; refreshToken?: string };
    if (t.accessToken) http.setAccessToken(t.accessToken);
    if (t.refreshToken) http.nativeRefreshToken = t.refreshToken;
    return r;
  };

  return {
    http,
    /** True after a sign-in, or after a successful silent refresh on page load. */
    restoreSession: () => http.refresh({ silent: true }),
    isSignedIn: () => http.accessToken !== null,

    auth: {
      login: async (body: LoginBody) =>
        adopt(
          await http.request('POST', '/auth/login', {
            json: body,
            schema: loginResponse,
            auth: false,
          }),
        ),
      google: async (tenant: string, idToken: string) =>
        adopt(
          await http.request('POST', '/auth/google', {
            json: { tenant, idToken },
            schema: loginResponse,
            auth: false,
          }),
        ),
      mfaVerify: async (body: { mfaToken: string; code?: string; recoveryCode?: string }) =>
        adopt(
          await http.request('POST', '/auth/mfa/verify', {
            json: body,
            schema: tokensResponse,
            auth: false,
          }),
        ),
      /** Pass the mfaToken during forced enrolment at sign-in; omit it from the security page. */
      mfaSetup: (mfaToken?: string) =>
        http.request('POST', '/auth/mfa/setup', {
          json: { mfaToken },
          schema: mfaSetupResponse,
          auth: !mfaToken,
        }),
      mfaConfirm: async (code: string, mfaToken?: string) =>
        adopt(
          await http.request('POST', '/auth/mfa/confirm', {
            json: { mfaToken, code },
            schema: mfaConfirmResponse,
            auth: !mfaToken,
          }),
        ),
      me: () => http.request('GET', '/auth/me', { schema: meResponse }),
      logout: async () => {
        await http.request('POST', '/auth/logout');
        http.setAccessToken(null);
      },
      logoutEverywhere: async () => {
        const r = await http.request('POST', '/auth/logout-all', {
          schema: z.object({ revoked: z.number() }),
        });
        http.setAccessToken(null);
        return r;
      },
      forgotPassword: (tenant: string, email: string) =>
        http.request('POST', '/auth/forgot-password', { json: { tenant, email }, auth: false }),
      resetPassword: (token: string, password: string) =>
        http.request('POST', '/auth/reset-password', { json: { token, password }, auth: false }),
    },

    people: {
      list: (query: PeopleListQuery = {}) =>
        http.request('GET', '/people', { query, schema: peopleListResponse }),
      get: (id: string) => http.request('GET', `/people/${id}`, { schema: engagementResponse }),
      create: (body: CreatePersonBody) =>
        http.request('POST', '/people', { json: body, schema: engagementResponse }),
      update: (id: string, body: UpdatePersonBody) =>
        http.request('PATCH', `/people/${id}`, { json: body, schema: engagementResponse }),
      invite: (id: string) =>
        http.request('POST', `/people/${id}/invite`, { schema: z.object({ email: z.string() }) }),
      /** `csv` is the file's text. Preview first (dryRun defaults to true), then commit with dryRun: false. */
      import: (csv: string, o: { dryRun?: boolean; createMissing?: boolean } = {}) =>
        http.request('POST', '/people/import', {
          body: csv,
          contentType: 'text/csv',
          query: { dryRun: o.dryRun ?? true, createMissing: o.createMissing ?? false },
          schema: importResult,
        }),
    },

    org: {
      entities: () => http.request('GET', '/org/entities', { schema: z.array(entityItem) }),
      list: (kind: OrgKind) => http.request('GET', `/org/${kind}`, { schema: z.array(orgItem) }),
      create: (
        kind: OrgKind,
        body: { name: string; city?: string | null; state?: string | null },
      ) => http.request('POST', `/org/${kind}`, { json: body }),
      update: (
        kind: OrgKind,
        id: string,
        body: { name?: string; city?: string | null; state?: string | null },
      ) => http.request('PATCH', `/org/${kind}/${id}`, { json: body }),
      remove: (kind: OrgKind, id: string) => http.request('DELETE', `/org/${kind}/${id}`),
    },

    settings: {
      get: () => http.request('GET', '/settings', { schema: settingsResponse }),
      setTenant: (key: string, value: unknown) =>
        http.request('PUT', `/settings/tenant/${key}`, { json: { value } }),
      clearTenant: (key: string) => http.request('DELETE', `/settings/tenant/${key}`),
      setMine: (key: string, value: unknown) =>
        http.request('PUT', `/settings/me/${key}`, { json: { value } }),
    },

    access: {
      roles: () => http.request('GET', '/access/roles', { schema: z.array(roleResponse) }),
      policies: () =>
        http.request('GET', '/access/policies', { schema: z.array(tenantRolePolicy) }),
      setPolicy: (roleKey: string, patch: TenantPolicyPatch) =>
        http.request('PUT', `/access/policies/${roleKey}`, { json: patch }),
      createRole: (name: string, mfaLevel: MfaLevel = 'OPTIONAL') =>
        http.request('POST', '/access/roles', {
          json: { name, mfaLevel },
          schema: z.object({ key: z.string(), name: z.string() }),
        }),
      assign: (userId: string, roleKey: string, entityId?: string) =>
        http.request('POST', '/access/user-roles', { json: { userId, roleKey, entityId } }),
      remove: (userId: string, roleKey: string, entityId?: string) =>
        http.request('DELETE', '/access/user-roles', { json: { userId, roleKey, entityId } }),
    },

    audit: {
      list: (
        query: {
          page?: number;
          pageSize?: number;
          entityType?: string;
          entityId?: string;
          action?: string;
        } = {},
      ) => http.request('GET', '/audit', { query, schema: auditListResponse }),
      verify: () => http.request('GET', '/audit/verify', { schema: chainCheck }),
    },

    files: {
      upload: (data: Blob, name: string, owner?: { ownerType: string; ownerId: string }) =>
        http.request('POST', '/files', {
          body: data,
          contentType: data.type,
          query: { name, ...owner },
          schema: fileResponse,
        }),
      get: (id: string) => http.request('GET', `/files/${id}`, { schema: fileResponse }),
      remove: (id: string) => http.request('DELETE', `/files/${id}`),
    },

    notifications: {
      list: () => http.request('GET', '/notifications', { schema: z.array(notificationItem) }),
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
