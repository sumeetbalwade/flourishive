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
  'files.read': 'Download files',
  'files.write': 'Upload and delete files',
  'documents.read': 'View issued documents and templates',
  'documents.manage': 'Manage letterheads, numbering and templates',
  'documents.generate': 'Generate documents from templates',
  'documents.approve': 'Approve documents or ask for changes',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

export type MfaLevelName = 'OFF' | 'OPTIONAL' | 'REQUIRED';

export interface SystemRole {
  key: string;
  name: string;
  /** Platform default and floor for two-step; tenants may only go up from the floor. */
  mfaLevel: MfaLevelName;
  mfaFloor: MfaLevelName;
  permissions: PermissionCode[];
}

export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: 'tenant_admin',
    name: 'Tenant Admin',
    mfaLevel: 'REQUIRED',
    mfaFloor: 'REQUIRED',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'hr_lead',
    name: 'HR Lead',
    mfaLevel: 'REQUIRED',
    mfaFloor: 'REQUIRED',
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
      'files.read',
      'files.write',
      'documents.read',
      'documents.manage',
      'documents.generate',
      'documents.approve',
    ],
  },
  {
    key: 'hr_executive',
    name: 'HR Executive',
    mfaLevel: 'REQUIRED',
    mfaFloor: 'REQUIRED',
    permissions: [
      'self.read',
      'people.read',
      'people.write',
      'people.import',
      'org.read',
      'files.read',
      'files.write',
      'documents.read',
      'documents.generate',
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    mfaLevel: 'OPTIONAL',
    mfaFloor: 'OFF',
    permissions: ['self.read', 'people.read', 'org.read'],
  },
  {
    key: 'employee',
    name: 'Employee',
    mfaLevel: 'OPTIONAL',
    mfaFloor: 'OFF',
    permissions: ['self.read'],
  },
  {
    key: 'intern',
    name: 'Intern',
    mfaLevel: 'OPTIONAL',
    mfaFloor: 'OFF',
    permissions: ['self.read'],
  },
];
