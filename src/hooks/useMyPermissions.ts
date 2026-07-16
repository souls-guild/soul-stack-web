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

  return { hasPermission, isLoading: q.isLoading };
}
