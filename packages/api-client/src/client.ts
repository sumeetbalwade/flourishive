import {
  billingState,
  checkoutBody,
  checkoutView,
  confirmBody,
  planView,
  subscriptionView,
  accountActionResult,
  accountListItem,
  accountView,
  securityInfo,
  passkeyView,
  senderState,
  domainView,
  setupChecklist,
  activeAnnouncement,
  maintenanceState,
  domainsState,
  senderView,
  testResult,
  alertSubscriptionsResponse,
  ruleMatrix,
  type SaveRulesBody,
  errorLogResponse,
  jobLogResponse,
  requestLogResponse,
  signinLogResponse,
  supportCopy,
  traceResponse,
  type ErrorLogQuery,
  type JobLogQuery,
  type RequestLogQuery,
  type SaveAlertsBody,
  type SigninLogQuery,
  deliveriesResponse,
  templateList,
  brandData,
  brandEditorState,
  brandAssetView,
  type BrandAssetKind,
  type BrandPatch,
  templateView,
  previewResponse,
  type SaveTemplateBody,
  type PreviewTemplateBody,
  type TestTemplateBody,
  type SaveSenderBody,
  type DeliveryQuery,
  type AccountAction,
  supportSessionView,
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
    status: z.string().default('GENERATED'),
    statusReason: z.string().nullable().default(null),
    supersededById: z.string().nullable().default(null),
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
const bulkSchema = z.object({
  id: z.string(),
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  pending: z.number(),
  finished: z.boolean(),
  rows: z.array(
    z.object({
      position: z.number(),
      status: z.enum(['PENDING', 'DONE', 'FAILED']),
      documentId: z.string().nullable(),
      reference: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
const deliverySchema = z.object({
  held: z.boolean(),
  releasedAt: z.string().nullable(),
  links: z.array(
    z.object({
      sentTo: z.string(),
      sentAt: z.string(),
      expiresAt: z.string(),
      active: z.boolean(),
    }),
  ),
});

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
      /** Passkeys. The browser half (`startRegistration`, `startAuthentication`) lives in the apps. */
      passkeyRegisterOptions: () =>
        http.request('POST', '/auth/passkeys/register/options', { schema: z.any() }),
      passkeyRegister: (response: unknown, label?: string) =>
        http.request('POST', '/auth/passkeys/register/verify', {
          json: { response, label },
          schema: passkeyView,
        }),
      passkeyRemove: (id: string) => http.request('DELETE', `/auth/passkeys/${id}`),
      /** Sign in with a passkey alone (no email or password). */
      passkeyLoginOptions: (tenant: string) =>
        http.request('POST', '/auth/passkeys/login/options', {
          json: { tenant },
          schema: z.any(),
          auth: false,
        }),
      passkeyLogin: async (tenant: string, response: unknown) =>
        adopt(
          await http.request('POST', '/auth/passkeys/login/verify', {
            json: { tenant, response },
            schema: tokensResponse,
            auth: false,
          }),
        ),
      /** The second step by passkey, after the password. */
      mfaPasskeyOptions: (mfaToken: string) =>
        http.request('POST', '/auth/mfa/passkey/options', {
          json: { mfaToken },
          schema: z.any(),
          auth: false,
        }),
      mfaPasskeyVerify: async (mfaToken: string, response: unknown) =>
        adopt(
          await http.request('POST', '/auth/mfa/passkey/verify', {
            json: { mfaToken, response },
            schema: tokensResponse,
            auth: false,
          }),
        ),
      /** Emails a sign-in code (where the role's policy allows it), after the password step. */
      mfaEmailCode: (mfaToken: string) =>
        http.request('POST', '/auth/mfa/email-code', { json: { mfaToken }, auth: false }),
      /** What My security shows: two-step state, what may be turned off, remembered devices. */
      security: () => http.request('GET', '/auth/security', { schema: securityInfo }),
      revokeDevice: (id: string) => http.request('DELETE', `/auth/trusted-devices/${id}`),
      /** Turns off your own two-step (where the policy is not REQUIRED). Needs the password again. */
      mfaDisable: (password: string) =>
        http.request('POST', '/auth/mfa/disable', { json: { password } }),
      mfaVerify: async (body: {
        mfaToken: string;
        code?: string;
        recoveryCode?: string;
        emailCode?: string;
        remember?: boolean;
      }) =>
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
      /** Confirm it is you (authenticator code, or the password if there is no two-step). Lasts five minutes. */
      stepUp: (body: { code?: string; password?: string }) =>
        http.request('POST', '/auth/step-up', { json: body }),
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
    /** The brand every screen loads first (D-62), and a company's published brand (D-61). */
    brand: {
      product: () => http.request('GET', '/public/brand', { schema: brandData, auth: false }),
      company: (slug: string) =>
        http.request('GET', `/public/company/${encodeURIComponent(slug)}/brand`, {
          schema: brandData,
          auth: false,
        }),
      /** The brand this company is showing right now. */
      current: () => http.request('GET', '/brand/current', { schema: brandData }),
      state: () => http.request('GET', '/brand', { schema: brandEditorState }),
      /** Uploads a PNG, JPEG or WebP; returns the picture's id to put in the draft. */
      uploadImage: (kind: BrandAssetKind, file: Blob) =>
        http.request('POST', '/brand/assets', {
          body: file,
          contentType: file.type,
          query: { kind },
          schema: brandAssetView,
        }),
      saveDraft: (draft: BrandPatch) =>
        http.request('PUT', '/brand/draft', { json: { draft }, schema: brandEditorState }),
      discardDraft: () => http.request('DELETE', '/brand/draft', { schema: brandEditorState }),
      previewEmail: (draft: BrandPatch, scheme: 'light' | 'dark') =>
        http.request('POST', '/brand/preview/email', {
          json: { draft, scheme },
          schema: previewResponse,
        }),
      publish: () => http.request('POST', '/brand/publish', { schema: brandEditorState }),
      revert: () => http.request('POST', '/brand/revert', { schema: brandEditorState }),
    },
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

    /** Company admin: look after the accounts in this company (D-63). */
    users: {
      list: () => http.request('GET', '/users', { schema: z.array(accountListItem) }),
      account: (id: string) => http.request('GET', `/users/${id}/account`, { schema: accountView }),
      act: (id: string, action: AccountAction, reason: string) =>
        http.request('POST', `/users/${id}/actions/${action}`, {
          json: { reason },
          schema: accountActionResult,
        }),
    },

    /** Platform staff looking at this company (D-56). */
    support: {
      sessions: () =>
        http.request('GET', '/support/sessions', { schema: z.array(supportSessionView) }),
      /** The banner's End session: ends the support session this tab is using. */
      endCurrent: () => http.request('POST', '/support/sessions/current/end'),
      end: (id: string) => http.request('POST', `/support/sessions/${id}/end`),
    },

    /** This company's own logs and the problems this person wants to hear about (D-67, D-68). */
    logs: {
      requests: (query: Partial<RequestLogQuery> = {}) =>
        http.request('GET', '/logs/requests', { query, schema: requestLogResponse }),
      errors: (query: Partial<ErrorLogQuery> = {}) =>
        http.request('GET', '/logs/errors', { query, schema: errorLogResponse }),
      signins: (query: Partial<SigninLogQuery> = {}) =>
        http.request('GET', '/logs/signins', { query, schema: signinLogResponse }),
      jobs: (query: Partial<JobLogQuery> = {}) =>
        http.request('GET', '/logs/jobs', { query, schema: jobLogResponse }),
      trace: (requestId: string) =>
        http.request('GET', `/logs/trace/${encodeURIComponent(requestId)}`, {
          schema: traceResponse,
        }),
      copy: (requestId: string) =>
        http.request('GET', `/logs/trace/${encodeURIComponent(requestId)}/copy`, {
          schema: supportCopy,
        }),
    },
    /** Who is told about which event (D-69). */
    notificationRules: {
      get: () => http.request('GET', '/notification-rules', { schema: ruleMatrix }),
      save: (body: SaveRulesBody) =>
        http.request('PUT', '/notification-rules', { json: body, schema: ruleMatrix }),
    },
    alerts: {
      list: () => http.request('GET', '/alerts', { schema: alertSubscriptionsResponse }),
      save: (body: SaveAlertsBody) =>
        http.request('PUT', '/alerts', { json: body, schema: alertSubscriptionsResponse }),
    },
    /** Banners and the maintenance switch (D-70). */
    announcements: {
      active: () =>
        http.request('GET', '/announcements/active', { schema: z.array(activeAnnouncement) }),
    },
    /** The company's plan, its limits and what it has used (D-20). */
    billing: {
      plan: () => http.request('GET', '/billing/plan', { schema: subscriptionView }),
      plans: () => http.request('GET', '/billing/plans', { schema: z.array(planView) }),
      state: () => http.request('GET', '/billing/state', { schema: billingState }),
      checkout: (body: z.input<typeof checkoutBody>) =>
        http.request('POST', '/billing/checkout', { json: body, schema: checkoutView }),
      confirm: (body: z.input<typeof confirmBody>) =>
        http.request('POST', '/billing/confirm', { json: body, schema: billingState }),
      cancel: () => http.request('POST', '/billing/cancel', { schema: billingState }),
    },
    setupChecklist: () => http.request('GET', '/setup/checklist', { schema: setupChecklist }),
    maintenance: () =>
      http.request('GET', '/public/maintenance', { schema: maintenanceState, auth: false }),
    /** The company's own web addresses, such as hr.company.com (D-69). */
    domains: {
      state: () => http.request('GET', '/domains', { schema: domainsState }),
      add: (hostname: string) =>
        http.request('POST', '/domains', { json: { hostname }, schema: domainView }),
      check: (id: string) => http.request('POST', `/domains/${id}/check`, { schema: domainView }),
      setPrimary: (hostname: string | null) =>
        http.request('PUT', '/domains/primary', { json: { hostname }, schema: domainsState }),
      remove: (id: string) => http.request('DELETE', `/domains/${id}`, { schema: domainsState }),
    },
    /** Who company email comes from, and the email log (D-58, D-60). */
    mail: {
      sender: () => http.request('GET', '/mail/sender', { schema: senderState }),
      saveSender: (body: SaveSenderBody) =>
        http.request('PUT', '/mail/sender', { json: body, schema: senderView }),
      startVerify: () => http.request('POST', '/mail/sender/verify/start'),
      confirmCode: (code: string) =>
        http.request('POST', '/mail/sender/verify/confirm', { json: { code }, schema: senderView }),
      test: () =>
        http.request('POST', '/mail/sender/test', {
          schema: testResult.extend({ sender: senderView }),
        }),
      dns: (dkimSelector?: string) =>
        http.request('POST', '/mail/sender/dns', { json: { dkimSelector }, schema: senderView }),
      activate: () => http.request('POST', '/mail/sender/activate', { schema: senderView }),
      removeSender: () => http.request('DELETE', '/mail/sender'),
      deliveries: (query: Partial<DeliveryQuery> = {}) =>
        http.request('GET', '/mail/deliveries', { query, schema: deliveriesResponse }),
      resend: (id: string) => http.request('POST', `/mail/deliveries/${id}/resend`),
      /** Reword the emails (D-59). */
      templates: {
        list: () => http.request('GET', '/mail/templates', { schema: templateList }),
        get: (event: string) =>
          http.request('GET', `/mail/templates/${event}`, { schema: templateView }),
        save: (event: string, body: SaveTemplateBody) =>
          http.request('PUT', `/mail/templates/${event}`, { json: body, schema: templateView }),
        reset: (event: string) =>
          http.request('DELETE', `/mail/templates/${event}`, { schema: templateView }),
        preview: (event: string, body: PreviewTemplateBody) =>
          http.request('POST', `/mail/templates/${event}/preview`, {
            json: body,
            schema: previewResponse,
          }),
        test: (event: string, body: TestTemplateBody) =>
          http.request('POST', `/mail/templates/${event}/test`, { json: body }),
      },
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
        body: {
          name: string;
          email: string;
          expiresInDays?: number;
          finalStep?: boolean;
          method?: 'OTP' | 'AADHAAR';
        },
      ) => http.request('POST', `/documents/${id}/signature-requests`, { json: body }),
      electronicOptions: (id: string) =>
        http.request('GET', `/documents/${id}/signature-requests/electronic`, {
          schema: z.object({ allowed: z.boolean(), requestId: z.string().nullable() }),
        }),
      signElectronically: (id: string, requestId: string, code: string) =>
        http.request(
          'POST',
          `/documents/${id}/signature-requests/${requestId}/sign-electronically`,
          {
            json: { code },
          },
        ),
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
      uploadTemplate: (file: Blob, q: { name: string; letterType: string }) =>
        http.request('POST', '/documents/templates/upload', {
          body: file,
          contentType: 'application/pdf',
          query: q,
          schema: templateSchema,
        }),
      addTemplateVersion: (
        id: string,
        body: { content?: Record<string, unknown>; fields?: z.infer<typeof fieldDefSchema>[] },
      ) => http.request('POST', `/documents/templates/${id}/versions`, { json: body }),
      installStarters: () =>
        http.request('POST', '/documents/templates/starters', {
          schema: z.object({ added: z.array(z.string()) }),
        }),
      startBulk: (body: {
        templateId: string;
        entityId: string;
        shared: Record<string, string>;
        rows: { personId?: string; engagementId?: string; fields: Record<string, string> }[];
      }) => http.request('POST', '/documents/bulk', { json: body, schema: bulkSchema }),
      bulk: (id: string) => http.request('GET', `/documents/bulk/${id}`, { schema: bulkSchema }),
      deliverBulk: (id: string) =>
        http.request('POST', `/documents/bulk/${id}/deliver`, {
          schema: z.object({
            sent: z.number(),
            results: z.array(
              z.object({ position: z.number(), sent: z.boolean(), reason: z.string().optional() }),
            ),
          }),
        }),
      deliver: (id: string, email?: string) =>
        http.request('POST', `/documents/${id}/deliver`, {
          json: email ? { email } : {},
          schema: z.object({ sent: z.boolean(), to: z.string(), held: z.boolean() }).loose(),
        }),
      deliveryStatus: (id: string) =>
        http.request('GET', `/documents/${id}/delivery`, { schema: deliverySchema }),
      releaseDownload: (id: string) => http.request('POST', `/documents/${id}/release`),
      holdDownload: (id: string) => http.request('POST', `/documents/${id}/hold`),
      revoke: (id: string, reason: string) =>
        http.request('POST', `/documents/${id}/revoke`, { json: { reason } }),
      supersede: (id: string, newDocumentId: string, reason: string) =>
        http.request('POST', `/documents/${id}/supersede`, { json: { newDocumentId, reason } }),
      revokeLinks: (id: string) => http.request('POST', `/documents/${id}/delivery/revoke`),
    },

    notifications: {
      list: () => http.request('GET', '/notifications', { schema: z.array(notificationItem) }),
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
