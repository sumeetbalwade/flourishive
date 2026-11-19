/**
 * The permission catalogue and the seeded roles. Later phases add their own codes
 * here and re-run the seed (it is idempotent) to sync them into every tenant.
 */
export const PERMISSIONS = {
  'self.read': 'See own profile and documents',
  'people.read': 'View people',
  'people.write': 'Create and edit people',
  'people.import': 'Import people from CSV',
  'org.read': 'View departments, designations and locations',
  'org.write': 'Manage departments, designations and locations',
  'roles.read': 'View roles and who holds them',
  'roles.assign': 'Assign and remove roles',
  'users.manage': 'Create, disable and reset user accounts',
  'settings.read': 'View tenant settings',
  'settings.manage': 'Change tenant settings',
  'audit.read': 'View the audit log',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

export interface SystemRole {
  key: string;
  name: string;
  mfaRequired: boolean;
  permissions: PermissionCode[];
}

export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: 'tenant_admin',
    name: 'Tenant Admin',
    mfaRequired: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'hr_lead',
    name: 'HR Lead',
    mfaRequired: true,
    permissions: [
      'self.read',
      'people.read',
      'people.write',
      'people.import',
      'org.read',
      'org.write',
      'roles.read',
      'roles.assign',
      'users.manage',
      'settings.read',
      'audit.read',
    ],
  },
  {
    key: 'hr_executive',
    name: 'HR Executive',
    mfaRequired: true,
    permissions: [
      'self.read',
      'people.read',
      'people.write',
      'people.import',
      'org.read',
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    mfaRequired: false,
    permissions: ['self.read', 'people.read', 'org.read'],
  },
  {
    key: 'employee',
    name: 'Employee',
    mfaRequired: false,
    permissions: ['self.read'],
  },
  {
    key: 'intern',
    name: 'Intern',
    mfaRequired: false,
    permissions: ['self.read'],
  },
];
