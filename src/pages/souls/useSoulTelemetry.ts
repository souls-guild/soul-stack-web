import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';

// Shared per-Soul telemetry query (NIM-127). The Utilization tab and the compact
// Overview strip use the same queryKey so TanStack Query dedupes into a single
// request/poll while either is enabled.
const REFETCH_MS = 15000;

export function useSoulTelemetry(sid: string, enabled: boolean) {
  return useQuery({
    queryKey: ['soul-telemetry', sid],
    queryFn: () => keeperApi.souls.telemetry(sid),
    enabled: Boolean(sid) && enabled,
    retry: false,
    refetchInterval: REFETCH_MS,
  });
}
