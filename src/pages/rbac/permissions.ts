// Каталог permissions берётся из backend (GET /v1/permissions, ADR-042) —
// единственный источник правды. Раньше тут был хардкод-список BASELINE, из-за
// которого UF слал несуществующий soul.read. Здесь — только нормализация
// (стабильная сортировка resource/action) для детерминированного рендера.

import type { PermissionResource } from '../../api/keeper';

export function normalizePermissionCatalog(
  items: readonly PermissionResource[] | undefined,
): PermissionResource[] {
  if (!items) return [];
  return items
    .map((res) => ({
      resource: res.resource,
      actions: [...res.actions].sort((a, b) => a.action.localeCompare(b.action)),
    }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}
