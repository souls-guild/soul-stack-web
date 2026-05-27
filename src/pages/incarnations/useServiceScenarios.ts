import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { keeperApi, type ServiceScenarioInfo } from '../../api/keeper';

// Тянет /v1/services/{name}/scenarios. Endpoint опционален (фиксируется параллельно
// в backend-slice-е), поэтому 404/501/network-fail отдаются как `unavailable: true`,
// и UI рисует text input fallback.
export interface ScenariosQueryResult {
  loading: boolean;
  unavailable: boolean;
  items: ServiceScenarioInfo[];
  error: string | null;
}

export function useServiceScenarios(serviceName: string | undefined): ScenariosQueryResult {
  const q = useQuery({
    queryKey: ['services.scenarios', serviceName],
    queryFn: () => keeperApi.services.listScenarios(serviceName!),
    enabled: Boolean(serviceName),
    retry: false,
  });

  return useMemo(() => {
    if (!serviceName) return { loading: false, unavailable: false, items: [], error: null };
    if (q.isLoading) return { loading: true, unavailable: false, items: [], error: null };
    if (q.error) {
      const status = q.error instanceof ApiError ? q.error.status : 0;
      const unavailable = status === 404 || status === 501 || status === 0 || status >= 500;
      return {
        loading: false,
        unavailable,
        items: [],
        error: unavailable
          ? null
          : q.error instanceof ApiError
            ? `Ошибка ${q.error.status}: ${q.error.message}`
            : String(q.error),
      };
    }
    return { loading: false, unavailable: false, items: q.data?.scenarios ?? [], error: null };
  }, [serviceName, q.isLoading, q.error, q.data]);
}
