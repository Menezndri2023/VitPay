/** Rôles et permissions — espace Business (par organisation) et VITPAY ADMIN (plateforme). */

export type OrgRole = 'owner' | 'admin' | 'cashier' | 'viewer';

export type OrgPermission =
  | 'org:read'
  | 'org:update'
  | 'members:manage'
  | 'pos:manage'
  | 'providers:manage'
  | 'requests:create'
  | 'requests:read'
  | 'requests:cancel'
  | 'refunds:create'
  | 'ledger:read'
  | 'exports:read';

const ORG_ROLE_PERMISSIONS: Record<OrgRole, readonly OrgPermission[]> = {
  owner: ['org:read', 'org:update', 'members:manage', 'pos:manage', 'providers:manage', 'requests:create', 'requests:read', 'requests:cancel', 'refunds:create', 'ledger:read', 'exports:read'],
  admin: ['org:read', 'org:update', 'pos:manage', 'providers:manage', 'requests:create', 'requests:read', 'requests:cancel', 'refunds:create', 'ledger:read', 'exports:read'],
  cashier: ['org:read', 'requests:create', 'requests:read'],
  viewer: ['org:read', 'requests:read', 'ledger:read', 'exports:read'],
};

export function orgRoleHas(role: OrgRole, perm: OrgPermission): boolean {
  return ORG_ROLE_PERMISSIONS[role].includes(perm);
}

export function orgRolePermissions(role: OrgRole): readonly OrgPermission[] {
  return ORG_ROLE_PERMISSIONS[role];
}

export type PlatformRole = 'super_admin' | 'admin' | 'finance' | 'compliance' | 'support' | 'technical' | 'auditor';

export type AdminPermission =
  | 'dashboard:read'
  | 'orgs:read'
  | 'orgs:read_pii'
  | 'orgs:suspend'
  | 'kyb:decide'
  | 'payments:read'
  | 'audit:read'
  | 'incidents:read'
  | 'incidents:manage'
  | 'approvals:request'
  | 'approvals:decide'
  | 'webhooks:read'
  | 'webhooks:replay'
  | 'reconciliation:run';

const ALL_ADMIN: readonly AdminPermission[] = [
  'dashboard:read', 'orgs:read', 'orgs:read_pii', 'orgs:suspend', 'kyb:decide', 'payments:read', 'audit:read',
  'incidents:read', 'incidents:manage', 'approvals:request', 'approvals:decide', 'webhooks:read', 'webhooks:replay', 'reconciliation:run',
];

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly AdminPermission[]> = {
  super_admin: ALL_ADMIN,
  admin: ['dashboard:read', 'orgs:read', 'orgs:read_pii', 'orgs:suspend', 'payments:read', 'audit:read', 'incidents:read', 'incidents:manage', 'approvals:request', 'approvals:decide', 'webhooks:read'],
  finance: ['dashboard:read', 'orgs:read', 'payments:read', 'incidents:read', 'incidents:manage', 'approvals:request', 'approvals:decide', 'reconciliation:run'],
  compliance: ['dashboard:read', 'orgs:read', 'orgs:read_pii', 'orgs:suspend', 'kyb:decide', 'payments:read', 'audit:read', 'incidents:read', 'approvals:request', 'approvals:decide'],
  support: ['dashboard:read', 'orgs:read', 'payments:read', 'incidents:read'],
  technical: ['dashboard:read', 'orgs:read', 'incidents:read', 'incidents:manage', 'webhooks:read', 'webhooks:replay'],
  auditor: ['dashboard:read', 'orgs:read', 'payments:read', 'audit:read', 'incidents:read', 'webhooks:read'],
};

export function platformRoleHas(role: PlatformRole, perm: AdminPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role].includes(perm);
}

export function platformRolePermissions(role: PlatformRole): readonly AdminPermission[] {
  return PLATFORM_ROLE_PERMISSIONS[role];
}
