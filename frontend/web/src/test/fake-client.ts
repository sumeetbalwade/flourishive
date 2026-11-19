import type { ApiClient } from '@flourishive/api-client';
import type { Engagement, MeResponse } from '@flourishive/schemas';
import { vi } from 'vitest';

export const ME: MeResponse = {
  id: 'u1',
  tenantId: 't1',
  email: 'hr@flourisense.test',
  mfaEnabled: true,
  mfaRequired: true,
  permissions: [
    'self.read',
    'people.read',
    'people.write',
    'people.import',
    'org.read',
    'org.write',
    'audit.read',
    'users.manage',
  ],
};

export const ASHA: Engagement = {
  id: 'e1',
  personId: 'p1',
  entityId: 'c1',
  type: 'EMPLOYEE',
  status: 'ACTIVE',
  employeeCode: 'E001',
  startDate: '2026-01-05T00:00:00.000Z',
  endDate: null,
  managerId: null,
  person: {
    id: 'p1',
    userId: null,
    firstName: 'Asha',
    lastName: 'Patil',
    workEmail: 'asha@flourisense.test',
    personalEmail: null,
    phone: null,
  },
  department: { id: 'd1', name: 'Finance' },
  designation: { id: 'g1', name: 'Manager' },
  location: null,
  intern: null,
  manager: null,
};

/** An API client whose every call is a spy. Override only what a test cares about. */
export function fakeClient(over: Record<string, unknown> = {}) {
  const base = {
    http: {},
    restoreSession: vi.fn().mockResolvedValue(false),
    isSignedIn: vi.fn().mockReturnValue(false),
    auth: {
      login: vi.fn(),
      google: vi.fn(),
      mfaVerify: vi.fn(),
      mfaSetup: vi.fn(),
      mfaConfirm: vi.fn(),
      me: vi.fn().mockResolvedValue(ME),
      logout: vi.fn().mockResolvedValue(undefined),
      logoutEverywhere: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    },
    people: {
      list: vi.fn().mockResolvedValue({ total: 1, page: 1, pageSize: 25, items: [ASHA] }),
      get: vi.fn().mockResolvedValue(ASHA),
      create: vi.fn(),
      update: vi.fn(),
      invite: vi.fn(),
      import: vi.fn(),
    },
    org: {
      entities: vi
        .fn()
        .mockResolvedValue([{ id: 'c1', name: 'Flourisense', legalName: 'Flourisense Pvt Ltd' }]),
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    settings: { get: vi.fn(), setTenant: vi.fn(), clearTenant: vi.fn(), setMine: vi.fn() },
    access: { roles: vi.fn(), assign: vi.fn(), remove: vi.fn() },
    audit: {
      list: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 25, items: [] }),
      verify: vi.fn(),
    },
    files: { upload: vi.fn(), get: vi.fn(), remove: vi.fn() },
    notifications: { list: vi.fn() },
  };
  return { ...base, ...over } as unknown as ApiClient & typeof base;
}
