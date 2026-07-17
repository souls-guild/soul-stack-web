// The permission catalog is sourced from the backend (GET /v1/permissions, ADR-042) —
// the single source of truth. Previously there was a hardcoded BASELINE list, which
// caused the UI to send a nonexistent soul.read. Here — normalization
// (stable resource/action sort) for deterministic rendering
// + utilities to build/parse the scoped-permission string.

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

// --- Scoped-permission string (backend contract) ---
// Formats: "resource.action" | "resource.action on key=value" | "resource.action on key=v1,v2"

export interface ParsedPermission {
  /** Base permission: "resource.action" */
  base: string;
  /** Scope key (incarnation / service / coven / host) or undefined */
  scopeKey?: string;
  /** Scope values (one or more, comma-separated) */
  scopeValues?: string[];
}

/**
 * Parses a permission string into a structure.
 * Unknown format -> base = the original string, scope = undefined.
 */
export function parsePermission(perm: string): ParsedPermission {
  const onIdx = perm.indexOf(' on ');
  if (onIdx === -1) return { base: perm };
  const base = perm.slice(0, onIdx);
  const scopePart = perm.slice(onIdx + 4); // after " on "
  const eqIdx = scopePart.indexOf('=');
  if (eqIdx === -1) return { base: perm }; // cannot parse -> return as-is
  const scopeKey = scopePart.slice(0, eqIdx).trim();
  const scopeValues = scopePart
    .slice(eqIdx + 1)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return { base, scopeKey, scopeValues: scopeValues.length > 0 ? scopeValues : undefined };
}

/**
 * Builds a permission string from the structure.
 * If scopeKey/scopeValues are empty — returns the bare base.
 */
export function buildPermission(parsed: ParsedPermission): string {
  if (!parsed.scopeKey || !parsed.scopeValues?.length) return parsed.base;
  return `${parsed.base} on ${parsed.scopeKey}=${parsed.scopeValues.join(',')}`;
}

/** Extracts selector_keys for the given base permission from the catalog. */
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

/**
 * Union of selector_keys across all actions of a resource — the set of scope keys for
 * the action-wildcard `resource.*` and for the group's bulk-scope picker.
 */
export function unionSelectorKeys(res: PermissionResource): string[] {
  const keys = new Set<string>();
  for (const act of (res.actions ?? [])) {
    for (const k of (act.selector_keys ?? [])) keys.add(k);
  }
  return Array.from(keys);
}
