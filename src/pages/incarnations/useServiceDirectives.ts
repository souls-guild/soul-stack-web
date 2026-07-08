import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';

// Тянет /v1/services/{name}/directives — каталог имён Redis-директив по сериям.
// Ответ immutable по git-ref → кэшируем агрессивно (staleTime: Infinity, ключ
// service+ref). version НЕ в ключе: серия выбирается на клиенте, ответ содержит все
// серии. Endpoint опционален (backend-slice параллельно) → 404/501/network отдаются
// как `unavailable: true`; MapEditor тогда не валидирует ключи (graceful-degrade).
export interface DirectivesQueryResult {
  loading: boolean;
  unavailable: boolean;
  // Серия ("8.2") → отсортированные имена директив. {} — каталог пуст/недоступен.
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
      // Любая ошибка (404/501/network/5xx) → каталог недоступен, не крашим форму.
      return { loading: false, unavailable: true, directives: {} };
    }
    return { loading: false, unavailable: false, directives: q.data?.directives ?? {} };
  }, [serviceName, q.isLoading, q.error, q.data]);
}
