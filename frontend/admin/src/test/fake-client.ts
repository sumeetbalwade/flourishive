import type { PlatformClient } from '@flourishive/api-client';
import type { StaffItem, TenantDetail, TenantListItem } from '@flourishive/schemas';
import { vi } from 'vitest';

export const TENANT: TenantListItem = {
  id: 't1',
  slug: 'flourisense',
  name: 'Flourisense',
  status: 'ACTIVE',
  createdAt: '2026-11-08T00:00:00.000Z',
  counts: { users: 14, engagements: 30, entities: 1 },
};
export const DETAIL: TenantDetail = {
  ...TENANT,
  entities: [{ id: 'c1', name: 'Flourisense', legalName: 'Flourisense Pvt Ltd' }],
  auditChain: { ok: true, checked: 42 },
  settingOverrides: { 'security.sessionDays': 3 },
};
export const ME_STAFF: StaffItem = {
  id: 's1',
  email: 'root@flourishive.test',
  status: 'ACTIVE',
  mfaEnabledAt: '2026-11-10T00:00:00.000Z',
  lastLoginAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

export function fakeClient(over: Record<string, unknown> = {}) {
  const base = {
    http: {},
    restoreSession: vi.fn().mockResolvedValue(false),
    isSignedIn: vi.fn().mockReturnValue(false),
    auth: {
      login: vi.fn(),
      mfaVerify: vi.fn(),
      mfaSetup: vi.fn(),
      mfaConfirm: vi.fn(),
      setPassword: vi.fn(),
      me: vi.fn().mockResolvedValue({ id: 's1', email: 'root@flourishive.test', mfaEnabled: true }),
      logout: vi.fn().mockResolvedValue(undefined),
    },
    tenants: {
      list: vi.fn().mockResolvedValue([TENANT]),
      get: vi.fn().mockResolvedValue(DETAIL),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      setSetting: vi.fn().mockResolvedValue(undefined),
      clearSetting: vi.fn().mockResolvedValue(undefined),
    },
    staff: {
      list: vi
        .fn()
        .mockResolvedValue([ME_STAFF, { ...ME_STAFF, id: 's2', email: 'second@flourishive.test' }]),
      invite: vi.fn(),
      setStatus: vi.fn().mockResolvedValue(undefined),
    },
    settings: {
      list: vi.fn().mockResolvedValue([
        {
          key: 'security.sessionDays',
          description: 'How long a sign-in lasts without activity',
          levels: ['tenant'],
          default: 14,
          platformValue: null,
        },
        {
          key: 'branding.accentColor',
          description: 'Accent colour',
          levels: ['tenant', 'entity'],
          default: '#c4914f',
          platformValue: null,
        },
      ]),
      set: vi.fn().mockResolvedValue(undefined),
    },
  };
  return { ...base, ...over } as unknown as PlatformClient & typeof base;
}
