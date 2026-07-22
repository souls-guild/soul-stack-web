import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';

// Fetches /v1/services/{name}/directives - a catalog of Redis directive names by series.
// The response is immutable per git-ref -> cached aggressively (staleTime: Infinity, key
// service+ref). version is NOT in the key: the series is chosen on the client, the response
// contains all series. Endpoint is optional (backend-slice in parallel) -> 404/501/network
// are returned as `unavailable: true`; MapEditor then doesn't validate keys (graceful-degrade).
export interface DirectivesQueryResult {
  loading: boolean;
  unavailable: boolean;
  // Series ("8.2") -> sorted directive names. {} - catalog empty/unavailable.
  directives: Record<string, string[]>;
}

export function useServiceDirectives(serviceName: string | undefined, ref?: string): DirectivesQueryResult {
  const q = useQuery({
    queryKey: ['services.directives', serviceName, ref],
    queryFn: () => keeperApi.services.listDirectives(serviceName!, { ref }),
    enabled: Boolean(serviceName),
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    if (!serviceName) return { loading: false, unavailable: false, directives: {} };
    if (q.isLoading) return { loading: true, unavailable: false, directives: {} };
    if (q.error) {
      // Any error (404/501/network/5xx) -> catalog unavailable, don't crash the form.
      return { loading: false, unavailable: true, directives: {} };
    }
    return { loading: false, unavailable: false, directives: q.data?.directives ?? {} };
  }, [serviceName, q.isLoading, q.error, q.data]);
}
