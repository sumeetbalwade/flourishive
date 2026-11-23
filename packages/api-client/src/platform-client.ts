import {
  accountActionResult,
  accountListItem,
  accountView,
  securityInfo,
  passkeyView,
  senderState,
  deliveriesResponse,
  templateList,
  templateView,
  previewResponse,
  type SaveTemplateBody,
  type PreviewTemplateBody,
  type TestTemplateBody,
  type DeliveryQuery,
  type AccountAction,
  platformRolesResponse,
  platformRoleView,
  supportSessionStarted,
  supportSessionView,
  type StartSupportBody,
  systemInfo,
  configTestResult,
  runtimeConfigEntry,
  createTenantResponse,
  mfaSetupResponse,
  platformMe,
  platformRolePolicy,
  platformSettingItem,
  staffInviteResponse,
  staffItem,
  tenantDetail,
  tenantListItem,
  tokensResponse,
  type CreateTenantBody,
  type PlatformPolicyPatch,
} from '@flourishive/schemas';
import { z } from 'zod';
import { Http, type HttpOptions } from './http.js';

type Opts = Omit<HttpOptions, 'refreshPath'>;

/** 'ok' means the platform policy did not require a code: the response then carries the tokens. */
const platformLogin = z.object({
  status: z.enum(['ok', 'mfa_required', 'mfa_setup_required']),
  mfaToken: z.string().optional(),
  methods: z.object({ code: z.boolean(), passkey: z.boolean() }).optional(),
  accessToken: z.string().optional(),
  expiresIn: z.number().optional(),
  refreshToken: z.string().optional(),
});
const platformConfirm = tokensResponse.extend({ recoveryCodes: z.array(z.string()) });

/** Client for the super admin console. Uses its own token endpoints; a tenant token never works here. */
export function createPlatformClient(opts: Opts) {
  const http = new Http({ ...opts, refreshPath: '/platform/auth/refresh' });
  const adopt = <R extends object>(r: R): R => {
    const t = r as { accessToken?: string; refreshToken?: string };
    if (t.accessToken) http.setAccessToken(t.accessToken);
    if (t.refreshToken) http.nativeRefreshToken = t.refreshToken;
    return r;
  };

  return {
    http,
    restoreSession: () => http.refresh({ silent: true }),
    isSignedIn: () => http.accessToken !== null,

    auth: {
      login: async (email: string, password: string) =>
        adopt(
          await http.request('POST', '/platform/auth/login', {
            json: { email, password },
            schema: platformLogin,
            auth: false,
          }),
        ),
      passkeyRegisterOptions: () =>
        http.request('POST', '/platform/auth/passkeys/register/options', { schema: z.any() }),
      passkeyRegister: (response: unknown, label?: string) =>
        http.request('POST', '/platform/auth/passkeys/register/verify', {
          json: { response, label },
          schema: passkeyView,
        }),
      passkeyRemove: (id: string) => http.request('DELETE', `/platform/auth/passkeys/${id}`),
      /** Sign in with a passkey alone (no email or password). */
      passkeyLoginOptions: () =>
        http.request('POST', '/platform/auth/passkeys/login/options', {
          schema: z.any(),
          auth: false,
        }),
      passkeyLogin: async (response: unknown) =>
        adopt(
          await http.request('POST', '/platform/auth/passkeys/login/verify', {
            json: { response },
            schema: tokensResponse,
            auth: false,
          }),
        ),
      mfaPasskeyOptions: (mfaToken: string) =>
        http.request('POST', '/platform/auth/mfa/passkey/options', {
          json: { mfaToken },
          schema: z.any(),
          auth: false,
        }),
      mfaPasskeyVerify: async (mfaToken: string, response: unknown) =>
        adopt(
          await http.request('POST', '/platform/auth/mfa/passkey/verify', {
            json: { mfaToken, response },
            schema: tokensResponse,
            auth: false,
          }),
        ),
      mfaEmailCode: (mfaToken: string) =>
        http.request('POST', '/platform/auth/mfa/email-code', { json: { mfaToken }, auth: false }),
      security: () => http.request('GET', '/platform/auth/security', { schema: securityInfo }),
      revokeDevice: (id: string) => http.request('DELETE', `/platform/auth/trusted-devices/${id}`),
      mfaDisable: (password: string) =>
        http.request('POST', '/platform/auth/mfa/disable', { json: { password } }),
      mfaVerify: async (body: {
        mfaToken: string;
        code?: string;
        recoveryCode?: string;
        emailCode?: string;
        remember?: boolean;
      }) =>
        adopt(
          await http.request('POST', '/platform/auth/mfa/verify', {
            json: body,
            schema: tokensResponse,
            auth: false,
          }),
        ),
      /** Lost authenticator, after the password step: emails a code to the account. */
      mfaRecoveryStart: (mfaToken: string) =>
        http.request('POST', '/platform/auth/mfa/recovery/email', {
          json: { mfaToken },
          auth: false,
        }),
      /** A correct code clears the old authenticator and returns a token to set up a new one. */
      mfaRecoveryVerify: (mfaToken: string, code: string) =>
        http.request('POST', '/platform/auth/mfa/recovery/email/verify', {
          json: { mfaToken, code },
          schema: z.object({ status: z.literal('mfa_setup_required'), mfaToken: z.string() }),
          auth: false,
        }),
      mfaSetup: (mfaToken: string) =>
        http.request('POST', '/platform/auth/mfa/setup', {
          json: { mfaToken },
          schema: mfaSetupResponse,
          auth: false,
        }),
      mfaConfirm: async (mfaToken: string, code: string) =>
        adopt(
          await http.request('POST', '/platform/auth/mfa/confirm', {
            json: { mfaToken, code },
            schema: platformConfirm,
            auth: false,
          }),
        ),
      setPassword: (token: string, password: string) =>
        http.request('POST', '/platform/auth/set-password', {
          json: { token, password },
          auth: false,
        }),
      me: () => http.request('GET', '/platform/auth/me', { schema: platformMe }),
      /** Confirm it is you (authenticator code, or the password if there is no two-step). Lasts five minutes. */
      stepUp: (body: { code?: string; password?: string }) =>
        http.request('POST', '/platform/auth/step-up', { json: body }),
      logout: async () => {
        await http.request('POST', '/platform/auth/logout');
        http.setAccessToken(null);
      },
    },

    /** The email log across companies, and a company's sender (D-58, D-60). */
    mail: {
      deliveries: (query: Partial<DeliveryQuery> = {}) =>
        http.request('GET', '/platform/mail/deliveries', { query, schema: deliveriesResponse }),
      resend: (id: string) => http.request('POST', `/platform/mail/deliveries/${id}/resend`),
      /** Reword the emails (D-59). */
      templates: {
        list: () => http.request('GET', '/platform/mail/templates', { schema: templateList }),
        get: (event: string) =>
          http.request('GET', `/platform/mail/templates/${event}`, { schema: templateView }),
        save: (event: string, body: SaveTemplateBody) =>
          http.request('PUT', `/platform/mail/templates/${event}`, {
            json: body,
            schema: templateView,
          }),
        reset: (event: string) =>
          http.request('DELETE', `/platform/mail/templates/${event}`, { schema: templateView }),
        preview: (event: string, body: PreviewTemplateBody) =>
          http.request('POST', `/platform/mail/templates/${event}/preview`, {
            json: body,
            schema: previewResponse,
          }),
        test: (event: string, body: TestTemplateBody) =>
          http.request('POST', `/platform/mail/templates/${event}/test`, { json: body }),
      },
      tenantSender: (tenantId: string) =>
        http.request('GET', `/platform/mail/tenants/${tenantId}/sender`, { schema: senderState }),
      removeTenantSender: (tenantId: string) =>
        http.request('DELETE', `/platform/mail/tenants/${tenantId}/sender`),
    },

    /** Account actions on a company's users and on other staff (D-63). */
    accounts: {
      users: (tenantId: string) =>
        http.request('GET', `/platform/tenants/${tenantId}/users`, {
          schema: z.array(accountListItem),
        }),
      account: (tenantId: string, id: string) =>
        http.request('GET', `/platform/tenants/${tenantId}/users/${id}/account`, {
          schema: accountView,
        }),
      act: (tenantId: string, id: string, action: AccountAction, reason: string) =>
        http.request('POST', `/platform/tenants/${tenantId}/users/${id}/actions/${action}`, {
          json: { reason },
          schema: accountActionResult,
        }),
      staff: (id: string) =>
        http.request('GET', `/platform/staff/${id}/account`, { schema: accountView }),
      staffAct: (id: string, action: AccountAction, reason: string) =>
        http.request('POST', `/platform/staff/${id}/actions/${action}`, {
          json: { reason },
          schema: accountActionResult,
        }),
    },

    roles: {
      /** The roles with what each may do, and the permission catalogue with plain-English labels. */
      list: () => http.request('GET', '/platform/roles', { schema: platformRolesResponse }),
      create: (body: { name: string; description?: string; permissions: string[] }) =>
        http.request('POST', '/platform/roles', { json: body, schema: platformRoleView }),
      update: (id: string, body: { name?: string; description?: string; permissions?: string[] }) =>
        http.request('PATCH', `/platform/roles/${id}`, { json: body }),
      remove: (id: string) => http.request('DELETE', `/platform/roles/${id}`),
      assign: (userId: string, roleId: string) =>
        http.request('PUT', `/platform/users/${userId}/role`, { json: { roleId } }),
    },

    support: {
      /** Opens a company with a reason. The result has the address to open (the token is in it). */
      start: (tenantId: string, body: StartSupportBody) =>
        http.request('POST', `/platform/tenants/${tenantId}/support-sessions`, {
          json: body,
          schema: supportSessionStarted,
        }),
      list: (tenantId: string) =>
        http.request('GET', `/platform/tenants/${tenantId}/support-sessions`, {
          schema: z.array(supportSessionView),
        }),
      end: (sessionId: string) =>
        http.request('POST', `/platform/support-sessions/${sessionId}/end`),
    },

    system: {
      info: () => http.request('GET', '/platform/system', { schema: systemInfo }),
      /** Stops the API; the server starts it again within seconds. Needs a fresh confirmation. */
      restart: () => http.request('POST', '/platform/system/restart'),
    },

    diagnostics: {
      storage: () =>
        http.request('GET', '/platform/diagnostics/storage', {
          schema: z.object({
            driver: z.enum(['local', 'r2']),
            ok: z.boolean(),
            latencyMs: z.number(),
            error: z.string().optional(),
            fallbackReads: z.number(),
          }),
        }),
    },

    tenants: {
      list: () => http.request('GET', '/platform/tenants', { schema: z.array(tenantListItem) }),
      get: (id: string) => http.request('GET', `/platform/tenants/${id}`, { schema: tenantDetail }),
      create: (body: CreateTenantBody) =>
        http.request('POST', '/platform/tenants', { json: body, schema: createTenantResponse }),
      update: (id: string, body: { name?: string; status?: 'ACTIVE' | 'SUSPENDED' }) =>
        http.request('PATCH', `/platform/tenants/${id}`, { json: body }),
      setSetting: (id: string, key: string, value: unknown) =>
        http.request('PUT', `/platform/tenants/${id}/settings/${key}`, { json: { value } }),
      clearSetting: (id: string, key: string) =>
        http.request('DELETE', `/platform/tenants/${id}/settings/${key}`),
    },

    staff: {
      list: () => http.request('GET', '/platform/users', { schema: z.array(staffItem) }),
      invite: (email: string, roleId: string) =>
        http.request('POST', '/platform/users', {
          json: { email, roleId },
          schema: staffInviteResponse,
        }),
      setStatus: (id: string, status: 'ACTIVE' | 'DISABLED') =>
        http.request('PATCH', `/platform/users/${id}`, { json: { status } }),
    },

    settings: {
      list: () =>
        http.request('GET', '/platform/settings', { schema: z.array(platformSettingItem) }),
      /** Change the value, the lock, or both. Leaving one out keeps it as it is. */
      set: (key: string, change: { value?: unknown; locked?: boolean }) =>
        http.request('PUT', `/platform/settings/${key}`, { json: change }),
      clear: (key: string) => http.request('DELETE', `/platform/settings/${key}`),
    },

    /** Keys, mail server and addresses (D-57). Secrets are write-only: only whether they are set comes back. */
    config: {
      list: () => http.request('GET', '/platform/config', { schema: z.array(runtimeConfigEntry) }),
      set: (key: string, value: string | number | boolean) =>
        http.request('PUT', `/platform/config/${key}`, { json: { value } }),
      clear: (key: string) => http.request('DELETE', `/platform/config/${key}`),
      test: (group: string) =>
        http.request('POST', `/platform/config/test/${group.toLowerCase().replace(/\s+/g, '-')}`, {
          schema: configTestResult,
        }),
    },

    policies: {
      list: () =>
        http.request('GET', '/platform/policies', { schema: z.array(platformRolePolicy) }),
      set: (roleKey: string, patch: PlatformPolicyPatch) =>
        http.request('PUT', `/platform/policies/${roleKey}`, { json: patch }),
    },
  };
}
export type PlatformClient = ReturnType<typeof createPlatformClient>;
