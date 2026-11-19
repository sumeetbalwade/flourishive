import {
  createTenantResponse,
  mfaSetupResponse,
  platformMe,
  platformSettingItem,
  staffInviteResponse,
  staffItem,
  tenantDetail,
  tenantListItem,
  tokensResponse,
  type CreateTenantBody,
} from '@flourishive/schemas';
import { z } from 'zod';
import { Http, type HttpOptions } from './http.js';

type Opts = Omit<HttpOptions, 'refreshPath'>;

const platformLogin = z.object({
  status: z.enum(['mfa_required', 'mfa_setup_required']),
  mfaToken: z.string(),
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
      login: (email: string, password: string) =>
        http.request('POST', '/platform/auth/login', {
          json: { email, password },
          schema: platformLogin,
          auth: false,
        }),
      mfaVerify: async (body: { mfaToken: string; code?: string; recoveryCode?: string }) =>
        adopt(
          await http.request('POST', '/platform/auth/mfa/verify', {
            json: body,
            schema: tokensResponse,
            auth: false,
          }),
        ),
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
      logout: async () => {
        await http.request('POST', '/platform/auth/logout');
        http.setAccessToken(null);
      },
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
      invite: (email: string) =>
        http.request('POST', '/platform/users', { json: { email }, schema: staffInviteResponse }),
      setStatus: (id: string, status: 'ACTIVE' | 'DISABLED') =>
        http.request('PATCH', `/platform/users/${id}`, { json: { status } }),
    },

    settings: {
      list: () =>
        http.request('GET', '/platform/settings', { schema: z.array(platformSettingItem) }),
      set: (key: string, value: unknown) =>
        http.request('PUT', `/platform/settings/${key}`, { json: { value } }),
    },
  };
}
export type PlatformClient = ReturnType<typeof createPlatformClient>;
