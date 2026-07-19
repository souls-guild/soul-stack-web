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

// --- Scoped-permission string (backend contract, NIM-128) ---
// Format: "resource.action" | "resource.action on <scope-expr>", where <scope-expr>
// is the CANONICAL boolean scope string (see scopeExpr.ts) — e.g.
// `incarnation.run on coven in (a, b) AND host matches "redis-*"`.
// The scope is treated as an opaque whole here; scopeExpr.ts parses/serializes it.

export interface ParsedPermission {
  /** Base permission: "resource.action" | "resource.*" | "*". */
  base: string;
  /** Canonical scope expression (everything after ` on `) or undefined. */
  scope?: string;
}

/**
 * Splits a permission string on the first ` on ` into base + scope expression.
 * No ` on ` (or an empty scope) -> just the base.
 */
export function parsePermission(perm: string): ParsedPermission {
  const onIdx = perm.indexOf(' on ');
  if (onIdx === -1) return { base: perm };
  const base = perm.slice(0, onIdx);
  const scope = perm.slice(onIdx + 4).trim(); // after " on "
  return scope ? { base, scope } : { base };
}

/**
 * Builds a permission string. An empty scope -> the bare base.
 */
export function buildPermission(parsed: ParsedPermission): string {
  const scope = parsed.scope?.trim();
  return scope ? `${parsed.base} on ${scope}` : parsed.base;
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
