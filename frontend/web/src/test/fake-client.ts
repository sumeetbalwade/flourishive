import type { ApiClient } from '@flourishive/api-client';
import type { Engagement, MeResponse } from '@flourishive/schemas';
import { vi } from 'vitest';

export const ME: MeResponse = {
  id: 'u1',
  tenantId: 't1',
  email: 'hr@flourisense.test',
  mfaEnabled: true,
  mfaRequired: true,
  mfaLevel: 'REQUIRED',
  disabledFeatures: [],
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
    brand: {
      current: vi.fn().mockRejectedValue(new Error('no brand')),
      company: vi.fn().mockRejectedValue(new Error('no brand')),
    },
    announcements: { active: vi.fn().mockResolvedValue([]) },
    maintenance: vi.fn().mockResolvedValue({ enabled: false, message: '', until: null }),
    company: {
      get: vi.fn().mockRejectedValue(new Error('no company')),
      find: vi.fn().mockResolvedValue(undefined),
    },
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
      recoveryStart: vi.fn().mockResolvedValue(undefined),
      recoveryVerify: vi.fn(),
      mfaRecoveryStart: vi.fn().mockResolvedValue(undefined),
      mfaRecoveryVerify: vi.fn(),
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
    settings: {
      get: vi.fn().mockResolvedValue({
        values: { 'security.passwordMinLength': 12, 'branding.accentColor': '#c4914f' },
        locked: ['branding.accentColor'],
        overridden: [],
        definitions: {
          'security.passwordMinLength': {
            levels: ['tenant'],
            description: 'Minimum password length',
            label: 'Minimum password length',
            group: 'Security',
            kind: 'number',
            min: 8,
            max: 64,
          },
          'branding.accentColor': {
            levels: ['tenant', 'entity'],
            description: 'Accent colour',
            label: 'Accent colour',
            group: 'Branding',
            kind: 'color',
          },
        },
      }),
      setTenant: vi.fn().mockResolvedValue(undefined),
      clearTenant: vi.fn().mockResolvedValue(undefined),
      setMine: vi.fn(),
    },
    access: {
      roles: vi.fn().mockResolvedValue([
        {
          key: 'hr_lead',
          name: 'HR Lead',
          isSystem: true,
          mfaLevel: 'REQUIRED',
          recoveryEmail: true,
          recoveryCodes: true,
          permissions: ['people.read', 'people.write'],
        },
        {
          key: 'employee',
          name: 'Employee',
          isSystem: true,
          mfaLevel: 'OPTIONAL',
          recoveryEmail: true,
          recoveryCodes: true,
          permissions: ['self.read'],
        },
      ]),
      userRoles: vi
        .fn()
        .mockResolvedValue([{ roleKey: 'employee', name: 'Employee', entityId: null }]),
      policies: vi.fn().mockResolvedValue([
        {
          roleKey: 'hr_lead',
          name: 'HR Lead',
          isSystem: true,
          mfaLevel: 'REQUIRED',
          mfaFloor: 'REQUIRED',
          recoveryEmail: true,
          recoveryCodes: true,
        },
        {
          roleKey: 'employee',
          name: 'Employee',
          isSystem: true,
          mfaLevel: 'OPTIONAL',
          mfaFloor: 'OFF',
          recoveryEmail: true,
          recoveryCodes: true,
        },
      ]),
      setPolicy: vi.fn().mockResolvedValue(undefined),
      createRole: vi.fn().mockResolvedValue({ key: 'custom_x', name: 'X' }),
      assign: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    audit: {
      list: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 25, items: [] }),
      verify: vi.fn(),
    },
    files: { upload: vi.fn(), get: vi.fn(), remove: vi.fn() },
    documents: {
      layouts: vi.fn().mockResolvedValue([]),
      templates: vi.fn().mockResolvedValue([]),
      createTemplate: vi.fn(),
      generate: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
      get: vi.fn(),
      history: vi.fn().mockResolvedValue({ state: 'draft', actions: [] }),
      act: vi.fn(),
      revise: vi.fn(),
      signatureRequests: vi.fn().mockResolvedValue([]),
      requestAcceptance: vi.fn(),
      cancelRequest: vi.fn(),
      letterheads: vi.fn().mockResolvedValue([]),
      uploadLetterhead: vi.fn(),
      numbering: vi.fn().mockResolvedValue([]),
      saveNumbering: vi.fn(),
    },
    notifications: { list: vi.fn() },
  };
  return { ...base, ...over } as unknown as ApiClient & typeof base;
}
