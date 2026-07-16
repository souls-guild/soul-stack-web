/**
 * Catalog of Herald channel types and their config fields (ADR-052 amendment, ADR-042).
 *
 * ADR-042: UI does not hardcode dynamic catalogs — backend serves the set of
 * channel types (webhook/telegram/slack/mattermost/discord/custom/email) and
 * descriptors of their config fields (name/label/required/secret/kind) via
 * GET /v1/herald-types. HeraldModal renders the per-type form FROM this catalog,
 * without hardcoding fields.
 */

import { useQuery } from '@tanstack/react-query';
import { keeperApi, type HeraldTypeFieldSpec } from '../../api/keeper';

/**
 * Fetches the Herald channel types catalog from backend (GET /v1/herald-types).
 * Returns:
 *   - types: array of {type, fields, secret_required} — one per known channel type.
 *   - fieldsByType: Record<type, fields> — fast lookup of the selected type's fields.
 *   - secretRequiredByType: Record<type, secret_required> — whether the type has a top-level secret_ref.
 *   - isLoading / isError: request status.
 *
 * Graceful fallback on fetch error: empty types/fieldsByType/secretRequiredByType
 * (the form does not crash, but with no catalog there is nothing to render specific
 * fields from — HeraldModal shows an error-state instead of a dynamic form).
 */
export function useHeraldTypeCatalog() {
  const q = useQuery({
    queryKey: ['herald-types.catalog'],
    queryFn: () => keeperApi.heraldTypes.list(),
    staleTime: Infinity,
    retry: 1,
  });

  const types = q.data?.types ?? [];
  const fieldsByType: Record<string, HeraldTypeFieldSpec[]> = {};
  const secretRequiredByType: Record<string, boolean> = {};
  for (const entry of types) {
    fieldsByType[entry.type] = entry.fields ?? [];
    secretRequiredByType[entry.type] = entry.secret_required;
  }

  return {
    types,
    fieldsByType,
    secretRequiredByType,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
