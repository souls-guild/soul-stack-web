/**
 * Каталог event_types для Tiding-правил (ADR-052, ADR-042).
 *
 * ADR-042: UI не хардкодит динамические каталоги — backend отдаёт их через
 * GET /v1/event-types (areas + point_events). Этот файл экспортирует хук
 * useEventTypeCatalog, который фетчит каталог и возвращает плоские массивы
 * для рендера чипов в TidingModal.
 *
 * KNOWN_EVENT_TYPE_AREAS — статический fallback, использовался до реализации
 * backend-эндпоинта. Теперь используется ТОЛЬКО в существующих тестах,
 * которые проверяют наличие конкретных типов. Не использовать в новом коде UI.
 */

import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';

/**
 * @deprecated Использовать useEventTypeCatalog. Оставлен только для тестов
 * совместимости. Источник правды — backend GET /v1/event-types.
 */
export const KNOWN_EVENT_TYPE_AREAS = [
  'scenario_run.*',
  'command_run.*',
  'voyage.*',
  'cadence.*',
  'incarnation.drift_checked',
  'incarnation.run_completed',
] as const;

/**
 * Фетчит каталог event-types с backend (GET /v1/event-types).
 * Возвращает:
 *   - areas: строки вида `scenario_run.*` (glob-подписки на всю область).
 *   - pointEvents: строки вида `incarnation.run_completed` (точечные типы).
 *   - allTypes: объединённый массив areas + pointEvents (для рендера чипов).
 *   - isLoading / isError: статус запроса.
 *
 * Graceful fallback при ошибке фетча: пустые массивы (чипов не будет,
 * пользователь может ввести тип вручную в кастомное поле).
 */
export function useEventTypeCatalog() {
  const q = useQuery({
    queryKey: ['event-types.catalog'],
    queryFn: () => keeperApi.eventTypes.list(),
    staleTime: Infinity,
    retry: 1,
  });

  const areas = q.data?.areas.map((a) => a.name) ?? [];
  const pointEvents = q.data?.point_events.map((p) => p.name) ?? [];
  const allTypes = [...areas, ...pointEvents];

  return {
    areas,
    pointEvents,
    allTypes,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
