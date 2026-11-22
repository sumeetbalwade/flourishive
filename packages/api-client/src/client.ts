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
  companyPublic,
  settingsResponse,
  tenantRolePolicy,
  userRoleItem,
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

const fieldDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'longtext', 'date', 'number', 'amount']),
  required: z.boolean(),
});
const templateVersionSchema = z
  .object({
    id: z.string(),
    version: z.number(),
    layoutKey: z.string().nullable(),
    orientation: z.string(),
    content: z.record(z.string(), z.unknown()),
    fields: z.array(fieldDefSchema),
  })
  .loose();
export const templateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    letterType: z.string(),
    archivedAt: z.string().nullable(),
    versions: z.array(templateVersionSchema),
  })
  .loose();
export type TemplateItem = z.infer<typeof templateSchema>;
const documentRowSchema = z
  .object({
    id: z.string(),
    reference: z.string(),
    letterType: z.string(),
    entityId: z.string(),
    personId: z.string().nullable(),
    personName: z.string().nullable(),
    pageCount: z.number(),
    createdAt: z.string(),
    state: z.string().nullable(),
  })
  .loose();
export type DocumentRow = z.infer<typeof documentRowSchema>;
const documentDetailSchema = z
  .object({
    id: z.string(),
    reference: z.string(),
    letterType: z.string(),
    entityId: z.string(),
    personId: z.string().nullable(),
    personName: z.string().nullable(),
    personEmail: z.string().nullable(),
    sha256: z.string(),
    pageCount: z.number(),
    createdAt: z.string(),
    data: z.record(z.string(), z.unknown()),
    downloadUrl: z.string(),
    workflow: z.object({
      state: z.string(),
      actions: z.array(
        z.object({ action: z.string(), label: z.string(), commentRequired: z.boolean() }),
      ),
    }),
  })
  .loose();
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
const historySchema = z.object({
  state: z.string(),
  actions: z.array(
    z
      .object({
        action: z.string(),
        fromState: z.string().nullable(),
        toState: z.string(),
        comment: z.string().nullable(),
        actorId: z.string().nullable(),
        createdAt: z.string(),
      })
      .loose(),
  ),
});
export type DocumentHistory = z.infer<typeof historySchema>;
const signatureRequestSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    method: z.string().optional(),
    createdAt: z.string(),
    expiresAt: z.string().nullable().optional(),
    parties: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          email: z.string().nullable().optional(),
          status: z.string(),
          respondedAt: z.string().nullable(),
        })
        .loose(),
    ),
    events: z.array(z.object({ type: z.string(), createdAt: z.string() }).loose()).default([]),
  })
  .loose();
export type SignatureRequestItem = z.infer<typeof signatureRequestSchema>;
const letterheadSchema = z
  .object({
    id: z.string(),
    entityId: z.string(),
    name: z.string(),
    orientation: z.enum(['PORTRAIT', 'LANDSCAPE']),
    version: z.number(),
    createdAt: z.string(),
  })
  .loose();
export type LetterheadItem = z.infer<typeof letterheadSchema>;
const numberingSchema = z
  .object({ id: z.string(), entityId: z.string(), letterType: z.string(), format: z.string() })
  .loose();
export type NumberingItem = z.infer<typeof numberingSchema>;
const layoutSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    orientation: z.string(),
    defaultContent: z.record(z.string(), z.unknown()),
    defaultFields: z.array(fieldDefSchema),
  })
  .loose();
export type LayoutItem = z.infer<typeof layoutSchema>;
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
      /** Forgot password, step 1: emails a 6-digit code. Always accepted. */
      recoveryStart: (tenant: string, email: string) =>
        http.request('POST', '/auth/recovery/email', { json: { tenant, email }, auth: false }),
      /** Step 2: a correct code returns a single-use token for resetPassword. */
      recoveryVerify: (tenant: string, email: string, code: string) =>
        http.request('POST', '/auth/recovery/email/verify', {
          json: { tenant, email, code },
          schema: z.object({ resetToken: z.string() }),
          auth: false,
        }),
      /** Lost authenticator, after the password step: emails a code to the account. */
      mfaRecoveryStart: (mfaToken: string) =>
        http.request('POST', '/auth/mfa/recovery/email', { json: { mfaToken }, auth: false }),
      /** A correct code clears the old authenticator and returns a token to set up a new one. */
      mfaRecoveryVerify: (mfaToken: string, code: string) =>
        http.request('POST', '/auth/mfa/recovery/email/verify', {
          json: { mfaToken, code },
          schema: z.object({ status: z.literal('mfa_setup_required'), mfaToken: z.string() }),
          auth: false,
        }),
      resetPassword: (token: string, password: string) =>
        http.request('POST', '/auth/reset-password', { json: { token, password }, auth: false }),
    },

    /** Open endpoints for the signed-out screens. */
    company: {
      get: (slug: string) =>
        http.request('GET', `/public/company/${encodeURIComponent(slug)}`, {
          schema: companyPublic,
          auth: false,
        }),
      /** Emails the person the sign-in address of each company they belong to. */
      find: (email: string) =>
        http.request('POST', '/public/find-company', { json: { email }, auth: false }),
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
      userRoles: (userId: string) =>
        http.request('GET', `/access/users/${userId}/roles`, { schema: z.array(userRoleItem) }),
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

    documents: {
      layouts: () => http.request('GET', '/documents/layouts', { schema: z.array(layoutSchema) }),
      templates: () =>
        http.request('GET', '/documents/templates', { schema: z.array(templateSchema) }),
      createTemplate: (body: {
        name: string;
        letterType: string;
        layoutKey: string;
        content?: Record<string, unknown>;
        fields?: z.infer<typeof fieldDefSchema>[];
      }) => http.request('POST', '/documents/templates', { json: body, schema: templateSchema }),
      generate: (body: {
        templateId: string;
        entityId: string;
        personId?: string;
        engagementId?: string;
        fields: Record<string, string>;
      }) =>
        http.request('POST', '/documents/generate', {
          json: body,
          schema: z.object({ id: z.string(), reference: z.string() }).loose(),
        }),
      list: (query: { page?: number; pageSize?: number; personId?: string } = {}) =>
        http.request('GET', '/documents', {
          query,
          schema: z.object({
            items: z.array(documentRowSchema),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        }),
      get: (id: string) =>
        http.request('GET', `/documents/${id}`, { schema: documentDetailSchema }),
      history: (id: string) =>
        http.request('GET', `/documents/${id}/history`, { schema: historySchema }),
      act: (id: string, action: string, comment?: string) =>
        http.request('POST', `/documents/${id}/actions`, { json: { action, comment } }),
      revise: (id: string, fields: Record<string, string>) =>
        http.request('POST', `/documents/${id}/revise`, { json: { fields } }),
      signatureRequests: (id: string) =>
        http.request('GET', `/documents/${id}/signature-requests`, {
          schema: z.array(signatureRequestSchema),
        }),
      requestAcceptance: (
        id: string,
        body: { name: string; email: string; expiresInDays?: number; finalStep?: boolean },
      ) => http.request('POST', `/documents/${id}/signature-requests`, { json: body }),
      cancelRequest: (id: string, requestId: string, reason: string) =>
        http.request('POST', `/documents/${id}/signature-requests/${requestId}/cancel`, {
          json: { reason },
        }),
      letterheads: () =>
        http.request('GET', '/documents/letterheads', { schema: z.array(letterheadSchema) }),
      uploadLetterhead: (
        file: Blob,
        q: { entityId: string; name: string; orientation: 'PORTRAIT' | 'LANDSCAPE' },
      ) =>
        http.request('POST', '/documents/letterheads', {
          body: file,
          contentType: file.type,
          query: q,
          schema: letterheadSchema,
        }),
      numbering: () =>
        http.request('GET', '/documents/numbering', { schema: z.array(numberingSchema) }),
      saveNumbering: (body: { entityId: string; letterType: string; format: string }) =>
        http.request('PUT', '/documents/numbering', { json: body, schema: numberingSchema }),
    },

    notifications: {
      list: () => http.request('GET', '/notifications', { schema: z.array(notificationItem) }),
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
