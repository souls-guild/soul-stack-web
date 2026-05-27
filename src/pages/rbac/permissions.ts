// Каталог permissions для autocomplete. API не предоставляет
// GET /v1/rbac/permissions, поэтому собираем union из existing role.permissions
// + добавляем известные базовые permission-ы (rbac.md / openapi).

import type { RoleView } from '../../api/keeper';

// Известные permission-ы (baseline — то, что упоминается в OpenAPI summaries
// и rbac.md). Дополняются union-ом из ролей, чтобы UI не отставал, если
// API введёт новый permission раньше, чем мы обновим список.
const BASELINE: readonly string[] = [
  '*',
  // Operator (ADR-013/014).
  'operator.create', 'operator.list', 'operator.read', 'operator.revoke', 'operator.update',
  // Role / RBAC.
  'role.create', 'role.list', 'role.delete', 'role.update',
  'role.grant-operator', 'role.revoke-operator',
  // Soul.
  'soul.list', 'soul.read', 'soul.exec', 'soul.delete', 'soul.coven.assign',
  'soul.issue-token',
  // Incarnation.
  'incarnation.list', 'incarnation.read', 'incarnation.create', 'incarnation.delete',
  'incarnation.run', 'incarnation.upgrade', 'incarnation.unlock',
  // Service.
  'service.list', 'service.read', 'service.register', 'service.update', 'service.deregister',
  // Plugin.
  'plugin.list', 'plugin.read', 'plugin.register', 'plugin.deregister',
  // Vigil / Decree (ADR-030).
  'vigil.list', 'vigil.read', 'vigil.create', 'vigil.delete',
  'decree.list', 'decree.read', 'decree.create', 'decree.delete',
  // Push.
  'push.apply', 'push.read',
  // Errand.
  'errand.list', 'errand.read', 'errand.create',
  // Audit.
  'audit.read',
];

export function buildPermissionCatalog(roles: readonly RoleView[]): string[] {
  const set = new Set<string>(BASELINE);
  for (const r of roles) {
    for (const p of r.permissions) set.add(p);
  }
  return Array.from(set).sort();
}
