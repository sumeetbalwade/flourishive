/**
 * What a member of platform staff may do (D-55). Roles are sets of these codes. Add new codes here
 * as features arrive; presets are re-synced on startup, so the Owner always has everything.
 */
export const PLATFORM_PERMISSIONS = {
  'tenants.read': {
    area: 'Companies',
    label: 'See companies',
    hint: 'List companies and open their details',
  },
  'tenants.manage': {
    area: 'Companies',
    label: 'Create and change companies',
    hint: 'Add, rename, suspend and fix the web address of a company',
  },
  'tenants.users.read': {
    area: 'Companies',
    label: 'See a company’s people accounts',
    hint: 'Names, status and sign-in state of accounts, never passwords',
  },
  'tenants.users.manage': {
    area: 'Companies',
    label: 'Manage a company’s accounts',
    hint: 'Reset passwords and two-step, disable accounts',
  },
  'tenants.data.read': {
    area: 'Companies',
    label: 'Open a company in view-only support mode',
    hint: 'Start a support session that can look but not change',
  },
  'tenants.data.write': {
    area: 'Companies',
    label: 'Open a company in change mode',
    hint: 'Start a support session that can change data. Use sparingly',
  },
  'staff.manage': {
    area: 'Staff',
    label: 'Manage platform staff',
    hint: 'Invite, suspend and assign roles to staff',
  },
  'roles.manage': {
    area: 'Staff',
    label: 'Manage staff roles',
    hint: 'Create roles and change what a role may do',
  },
  'config.read': {
    area: 'Settings',
    label: 'See integrations and defaults',
    hint: 'View platform defaults, integrations and system checks. Secrets stay hidden',
  },
  'config.secrets.manage': {
    area: 'Settings',
    label: 'Change keys and passwords',
    hint: 'Set the mail password, API keys and other secrets',
  },
  'email.manage': {
    area: 'Settings',
    label: 'Manage email',
    hint: 'Senders, templates and delivery',
  },
  'brand.manage': {
    area: 'Settings',
    label: 'Manage branding',
    hint: 'Product and company look and feel',
  },
  'logs.read': {
    area: 'Logs',
    label: 'Read logs',
    hint: 'Request and error logs',
  },
  'logs.errors.detail': {
    area: 'Logs',
    label: 'See error details',
    hint: 'Stack traces and request details',
  },
  'alerts.manage': {
    area: 'Logs',
    label: 'Manage alerts',
    hint: 'Choose who is told about problems',
  },
  'audit.read': {
    area: 'Logs',
    label: 'Read the platform audit trail',
    hint: 'Who changed what on the platform',
  },
  'billing.manage': {
    area: 'Platform',
    label: 'Manage plans and billing',
    hint: 'Edit plans and limits, and move a company to another plan',
  },
  'platform.controls': {
    area: 'Platform',
    label: 'Use platform controls',
    hint: 'Restart the API and other platform-wide switches',
  },
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
export const ALL_PLATFORM_PERMISSIONS = Object.keys(
  PLATFORM_PERMISSIONS,
) as PlatformPermission[];
export const isPlatformPermission = (c: string): c is PlatformPermission =>
  c in PLATFORM_PERMISSIONS;

export interface PresetRole {
  /** A fixed id, so a migration can point existing staff at it. */
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: PlatformPermission[];
}

const without = (...omit: PlatformPermission[]) =>
  ALL_PLATFORM_PERMISSIONS.filter((p) => !omit.includes(p));

export const PRESET_ROLES: PresetRole[] = [
  {
    id: '00000000-0000-7000-8000-000000000001',
    key: 'owner',
    name: 'Owner',
    description:
      'Everything, including who else is staff and what roles can do',
    permissions: ALL_PLATFORM_PERMISSIONS,
  },
  {
    id: '00000000-0000-7000-8000-000000000002',
    key: 'super_admin',
    name: 'Super admin',
    description:
      'Everything except managing staff and roles, and changing secrets',
    permissions: without(
      'staff.manage',
      'roles.manage',
      'config.secrets.manage',
    ),
  },
  {
    id: '00000000-0000-7000-8000-000000000003',
    key: 'support',
    name: 'Support',
    description:
      'See companies, accounts and logs, and open view-only support sessions',
    permissions: [
      'tenants.read',
      'tenants.users.read',
      'tenants.data.read',
      'logs.read',
    ],
  },
  {
    id: '00000000-0000-7000-8000-000000000004',
    key: 'auditor',
    name: 'Read-only auditor',
    description:
      'See companies, logs and the platform audit trail. Cannot open companies',
    permissions: ['tenants.read', 'logs.read', 'audit.read'],
  },
];
export const OWNER_ROLE_ID = PRESET_ROLES[0]!.id;
