// Каталог permissions берётся из backend (GET /v1/permissions, ADR-042) —
// единственный источник правды. Раньше тут был хардкод-список BASELINE, из-за
// которого UF слал несуществующий soul.read. Здесь — нормализация
// (стабильная сортировка resource/action) для детерминированного рендера
// + утилиты сборки/парсинга scoped-permission строки.

import type { PermissionResource } from '../../api/keeper';

export function normalizePermissionCatalog(
  items: readonly PermissionResource[] | undefined,
): PermissionResource[] {
  if (!items) return [];
  return items
    .map((res) => ({
      resource: res.resource,
      actions: [...(res.actions ?? [])].sort((a, b) => a.action.localeCompare(b.action)),
    }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

// --- Scoped-permission строка (backend-контракт) ---
// Форматы: "resource.action" | "resource.action on key=value" | "resource.action on key=v1,v2"

export interface ParsedPermission {
  /** Базовое право: "resource.action" */
  base: string;
  /** Scope-ключ (incarnation / service / coven / host) или undefined */
  scopeKey?: string;
  /** Scope-значения (один или несколько через запятую) */
  scopeValues?: string[];
}

/**
 * Парсит permission-строку в структуру.
 * Неизвестный формат → base = исходная строка, scope = undefined.
 */
export function parsePermission(perm: string): ParsedPermission {
  const onIdx = perm.indexOf(' on ');
  if (onIdx === -1) return { base: perm };
  const base = perm.slice(0, onIdx);
  const scopePart = perm.slice(onIdx + 4); // после " on "
  const eqIdx = scopePart.indexOf('=');
  if (eqIdx === -1) return { base: perm }; // не можем распарсить → возвращаем как есть
  const scopeKey = scopePart.slice(0, eqIdx).trim();
  const scopeValues = scopePart
    .slice(eqIdx + 1)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return { base, scopeKey, scopeValues: scopeValues.length > 0 ? scopeValues : undefined };
}

/**
 * Собирает permission-строку из структуры.
 * Если scopeKey/scopeValues пусты — возвращает голый base.
 */
export function buildPermission(parsed: ParsedPermission): string {
  if (!parsed.scopeKey || !parsed.scopeValues?.length) return parsed.base;
  return `${parsed.base} on ${parsed.scopeKey}=${parsed.scopeValues.join(',')}`;
}

/** Извлекает selector_keys для данного base-права из каталога. */
export function getSelectorKeys(
  catalog: readonly PermissionResource[],
  base: string,
): string[] {
  const dotIdx = base.indexOf('.');
  if (dotIdx === -1) return [];
  const resource = base.slice(0, dotIdx);
  const action = base.slice(dotIdx + 1);
  for (const res of catalog) {
    if (res.resource !== resource) continue;
    for (const act of (res.actions ?? [])) {
      if (act.action === action) return act.selector_keys ?? [];
    }
  }
  return [];
}
