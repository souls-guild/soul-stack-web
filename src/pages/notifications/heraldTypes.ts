/**
 * Каталог типов Herald-канала и их config-полей (ADR-052 amendment, ADR-042).
 *
 * ADR-042: UI не хардкодит динамические каталоги — backend отдаёт набор типов
 * канала (webhook/telegram/slack/mattermost/discord/custom/email) и дескрипторы
 * их config-полей (name/label/required/secret/kind) через GET /v1/herald-types.
 * HeraldModal рендерит форму per-type ИЗ этого каталога, не хардкодя поля.
 */

import { useQuery } from '@tanstack/react-query';
import { keeperApi, type HeraldTypeFieldSpec } from '../../api/keeper';

/**
 * Фетчит каталог типов Herald-канала с backend (GET /v1/herald-types).
 * Возвращает:
 *   - types: массив {type, fields, secret_required} — по одному на каждый известный тип канала.
 *   - fieldsByType: Record<type, fields> — быстрый доступ к полям выбранного типа.
 *   - secretRequiredByType: Record<type, secret_required> — есть ли у типа top-level secret_ref.
 *   - isLoading / isError: статус запроса.
 *
 * Graceful fallback при ошибке фетча: пустые types/fieldsByType/secretRequiredByType
 * (форма не крашится, но без каталога рендерить конкретные поля нечем — HeraldModal
 * показывает error-state вместо динамической формы).
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
