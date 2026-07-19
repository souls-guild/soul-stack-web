import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../api/keeper';

/**
 * Hook for getting the effective permissions of the current Archon (GET /v1/me/permissions).
 *
 * wildcard=true (cluster-admin) → hasPermission() returns true for any permission.
 * Otherwise we check for a resource+action match (without scope comparison — the UI
 * uses hasPermission only to show/hide buttons, not for authorization).
 *
 * While data is loading — hasPermission returns true (optimistic), so buttons
 * don't flicker on init. If the fetch failed (403/500) — same, we return
 * true (graceful; the backend will give 403 on the actual call).
 */
export function useMyPermissions() {
  const q = useQuery({
    queryKey: ['me.permissions'],
    queryFn: () => keeperApi.permissions.listMy(),
    staleTime: 60_000,
    retry: false,
  });

  function hasPermission(permission: string): boolean {
    // While loading or on error — show buttons (optimistic).
    if (!q.data) return true;

    const perms = q.data.permissions ?? [];
    // Cluster-admin: wildcard=true → everything allowed.
    if (perms.some((p) => p.wildcard)) return true;

    // Parse "resource.action" (format from the permission catalog: synod.create etc.)
    const dot = permission.indexOf('.');
    if (dot === -1) return false;
    const resource = permission.slice(0, dot);
    const action = permission.slice(dot + 1);

    return perms.some(
      (p) =>
        p.resource === resource &&
        (p.action === action || p.action === '*'),
    );
  }

  /**
   * The caller's own inherited scope ceiling for a base permission `resource.action`
   * (or `resource.*`). Least-privilege: the server caps any grant to a subset of
   * what the caller holds (403 on exceeding it) — this exposes that ceiling so the
   * UI can show it up front. Returns null when the ceiling is unknown (still loading,
   * fetch failed, or no matching held permission) → callers hide the block.
   */
  function ceilingFor(base: string): { unrestricted: boolean; exprs: string[] } | null {
    if (!q.data) return null;
    const perms = q.data.permissions ?? [];

    // The wildcard entry is the ceiling for the full-access base `*` and the
    // fallback ceiling for any base with no more-specific held permission. A
    // BARE `*` (or an unrestricted-scope wildcard) → unrestricted; a scoped
    // `* on X` (NIM-128) → its own predicates cap every grant.
    const wild = perms.find((p) => p.wildcard);
    const wildCeiling = wild
      ? !wild.scope || wild.scope.unrestricted
        ? { unrestricted: true, exprs: [] }
        : { unrestricted: false, exprs: wild.scope.exprs ?? [] }
      : null;

    if (base === '*') return wildCeiling;

    const dot = base.indexOf('.');
    if (dot === -1) return wildCeiling;
    const resource = base.slice(0, dot);
    const action = base.slice(dot + 1);

    const match = perms.find(
      (p) => !p.wildcard && p.resource === resource && (p.action === action || p.action === '*' || action === '*'),
    );
    if (!match) return wildCeiling;
    const scope = match.scope;
    if (!scope || scope.unrestricted) return { unrestricted: true, exprs: [] };
    return { unrestricted: false, exprs: scope.exprs ?? [] };
  }

  return { hasPermission, ceilingFor, isLoading: q.isLoading };
}
