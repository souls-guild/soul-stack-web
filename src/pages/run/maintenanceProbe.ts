import { useQueries } from '@tanstack/react-query';
import { keeperApi, type Freeze, type MaintenanceStatus } from '../../api/keeper';
import { ApiError } from '../../api/client';
import {
  freezeCovers,
  freezesKey,
  windowsKey,
} from '../incarnations/maintenance';

// What the Run dialog needs to know about its targets' windows and freezes (NIM-1076).

// Two reads per target. Past this many targets the wizard stops asking ahead and
// leaves the freeze to Keeper's 409, which names every frozen target.
export const MAINTENANCE_PROBE_LIMIT = 20;

export interface TargetMaintenance {
  name: string;
  status?: MaintenanceStatus;
  hasWindows: boolean;
  // The freeze covering the moment the run would start, if any.
  freeze?: Freeze;
  error?: string;
}

export interface MaintenanceProbe {
  capped: boolean;
  loading: boolean;
  targets: TargetMaintenance[];
  frozen: TargetMaintenance[];
  // Identifies the set of freezes consent was given for: a change in it asks again.
  frozenKey: string;
}

/**
 * Reads each target's windows reply (status block) and, for a start in the future,
 * its freezes. "Frozen at the start" is the server's active_freeze for an immediate
 * run, and a freeze interval covering schedule_at for a scheduled one — consent is
 * checked against the start moment (ADR-0093 §5).
 */
export function useTargetMaintenance(incarnations: string[], enabled: boolean, startAt: Date | null): MaintenanceProbe {
  const capped = incarnations.length > MAINTENANCE_PROBE_LIMIT;
  const probed = enabled && !capped ? incarnations : [];
  const future = startAt !== null && startAt.getTime() > Date.now();

  const windowQs = useQueries({
    queries: probed.map((name) => ({
      queryKey: windowsKey(name),
      queryFn: () => keeperApi.maintenance.listWindows(name),
      retry: false,
      staleTime: 15_000,
    })),
  });
  const freezeQs = useQueries({
    queries: (future ? probed : []).map((name) => ({
      queryKey: freezesKey(name),
      queryFn: () => keeperApi.maintenance.listFreezes(name),
      retry: false,
      staleTime: 15_000,
    })),
  });

  const loading = windowQs.some((q) => q.isLoading) || freezeQs.some((q) => q.isLoading);

  const targets: TargetMaintenance[] = probed.map((name, i) => {
    const w = windowQs[i]?.data;
    const err = windowQs[i]?.error;
    if (!w?.status) {
      // 404/501: a Keeper without windows has nothing to defer to and no freeze.
      const degraded = err instanceof ApiError && (err.status === 404 || err.status === 501);
      return {
        name,
        hasWindows: false,
        error: err && !degraded ? (err instanceof ApiError ? String(err.status) : String(err)) : undefined,
      };
    }
    const freeze = future && startAt
      ? (freezeQs[i]?.data?.items ?? []).find((f) => freezeCovers(f, startAt))
      : w.status.active_freeze;
    return { name, status: w.status, hasWindows: (w.items ?? []).length > 0, freeze };
  });
  const frozen = targets.filter((x) => x.freeze);
  const frozenKey = frozen.map((x) => `${x.name}:${x.freeze?.id}`).sort().join(',');
  return { capped, loading, targets, frozen, frozenKey };
}
