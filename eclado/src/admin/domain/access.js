export const BACKOFFICE_PERMISSIONS = Object.freeze({
  CATALOG_READ: 'catalog.read',
  CATALOG_WRITE: 'catalog.write',
  MEMBER_PRICING_MANAGE: 'member_pricing.manage',
  INSTRUCTOR_STUDENTS_MANAGE: 'instructor_students.manage',
  ORDERS_READ: 'orders.read',
  ORDERS_WRITE: 'orders.write',
  MEMBERS_READ: 'members.read',
  MEMBERS_WRITE: 'members.write',
  PROMOTIONS_MANAGE: 'promotions.manage',
  PROCUREMENT_MANAGE: 'procurement.manage',
  ANALYTICS_READ: 'analytics.read',
  AUDIT_LOGS_READ: 'audit_logs.read',
  NOTIFICATIONS_SEND: 'notifications.send',
  BACKORDERS_MANAGE: 'backorders.manage',
  INVENTORY_COUNTS_MANAGE: 'inventory_counts.manage',
  REWARD_WITHDRAWALS_READ: 'rewards.withdrawals.read',
  REWARD_WITHDRAWALS_MANAGE: 'rewards.withdrawals.manage',
  SHOPPING_CREDIT_MANAGE: 'shopping_credit.manage',
});

export const BACKOFFICE_ROLE_LABELS = Object.freeze({
  super_admin: '最高管理員',
  admin: '管理員',
  catalog_editor: '商品小編',
});

export const PAGE_PERMISSIONS = Object.freeze({
  dashboard: BACKOFFICE_PERMISSIONS.ORDERS_READ,
  orders: BACKOFFICE_PERMISSIONS.ORDERS_READ,
  catalog: BACKOFFICE_PERMISSIONS.CATALOG_READ,
  products: BACKOFFICE_PERMISSIONS.CATALOG_READ,
  inventory: BACKOFFICE_PERMISSIONS.CATALOG_READ,
  backorders: BACKOFFICE_PERMISSIONS.BACKORDERS_MANAGE,
  inventory_counts: BACKOFFICE_PERMISSIONS.INVENTORY_COUNTS_MANAGE,
  procurement: BACKOFFICE_PERMISSIONS.PROCUREMENT_MANAGE,
  promotions: BACKOFFICE_PERMISSIONS.PROMOTIONS_MANAGE,
  ai: BACKOFFICE_PERMISSIONS.PROCUREMENT_MANAGE,
  members: BACKOFFICE_PERMISSIONS.MEMBERS_READ,
  applications: BACKOFFICE_PERMISSIONS.MEMBERS_READ,
  renewals: BACKOFFICE_PERMISSIONS.MEMBERS_READ,
  audit: BACKOFFICE_PERMISSIONS.AUDIT_LOGS_READ,
  analytics: BACKOFFICE_PERMISSIONS.ANALYTICS_READ,
  settings: BACKOFFICE_PERMISSIONS.MEMBER_PRICING_MANAGE,
});

export function normalizeBackofficeAccess(value) {
  const role = typeof value?.role === 'string' ? value.role : '';
  const permissions = Array.isArray(value?.permissions)
    ? [...new Set(value.permissions.filter(permission => typeof permission === 'string'))]
    : [];
  return { role, permissions };
}

export function hasBackofficePermission(access, permission) {
  return normalizeBackofficeAccess(access).permissions.includes(permission);
}

export function canAccessBackofficePage(access, page) {
  if (page === 'withdrawals') return ['admin','super_admin'].includes(access?.role) && hasBackofficePermission(access,BACKOFFICE_PERMISSIONS.REWARD_WITHDRAWALS_READ);
  if (page === 'rewards') return ['admin', 'super_admin'].includes(access?.role) && hasBackofficePermission(access, BACKOFFICE_PERMISSIONS.ORDERS_READ) && hasBackofficePermission(access, BACKOFFICE_PERMISSIONS.MEMBERS_READ);
  if (page === 'settings' && hasBackofficePermission(access, BACKOFFICE_PERMISSIONS.INSTRUCTOR_STUDENTS_MANAGE)) return true;
  const permission = PAGE_PERMISSIONS[page];
  return Boolean(permission) && hasBackofficePermission(access, permission);
}

export function getDefaultBackofficePage(access) {
  if (canAccessBackofficePage(access, 'dashboard')) return 'dashboard';
  if (canAccessBackofficePage(access, 'catalog')) return 'catalog';
  return '';
}
