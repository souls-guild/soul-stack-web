/**
 * Catalog of event_types for Tiding rules (ADR-052, ADR-042).
 *
 * ADR-042: UI does not hardcode dynamic catalogs — backend serves them via
 * GET /v1/event-types (areas + point_events). This file exports the
 * useEventTypeCatalog hook, which fetches the catalog and returns flat arrays
 * for rendering chips in TidingModal.
 *
 * KNOWN_EVENT_TYPE_AREAS — a static fallback, used before the backend
 * endpoint was implemented. Now used ONLY in existing tests that check for
 * specific types. Do not use in new UI code.
 */

import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';

/**
 * @deprecated Use useEventTypeCatalog. Kept only for test
 * compatibility. Source of truth — backend GET /v1/event-types.
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
 * Fetches the event-types catalog from backend (GET /v1/event-types).
 * Returns:
 *   - areas: strings like `scenario_run.*` (glob subscriptions for a whole area).
 *   - pointEvents: strings like `incarnation.run_completed` (point types).
 *   - allTypes: combined array of areas + pointEvents (for rendering chips).
 *   - isLoading / isError: request status.
 *
 * Graceful fallback on fetch error: empty arrays (no chips shown,
 * the user can still type a type manually in the custom field).
 */
export function useEventTypeCatalog() {
  const q = useQuery({
    queryKey: ['event-types.catalog'],
    queryFn: () => keeperApi.eventTypes.list(),
    staleTime: Infinity,
    retry: 1,
  });

  const areas = (q.data?.areas ?? []).map((a) => a.name);
  const pointEvents = (q.data?.point_events ?? []).map((p) => p.name);
  const allTypes = [...areas, ...pointEvents];

  return {
    areas,
    pointEvents,
    allTypes,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
