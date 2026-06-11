/**
 * Известные области event_types для Tiding-правил (ADR-052, S5).
 *
 * [NOTE: backend-каталога областей нет — это статический список кандидата на
 * ADR-042-каталог. Если/когда backend добавит эндпоинт GET /v1/event-types,
 * этот список заменяется фетчем, как требует ADR-042.]
 *
 * Список намеренно хранится в одном месте (этом файле) и не дублируется.
 */

export const KNOWN_EVENT_TYPE_AREAS = [
  'scenario_run.*',
  'command_run.*',
  'voyage.*',
  'cadence.*',
  'incarnation.drift_checked',
] as const;

export type KnownEventTypeArea = (typeof KNOWN_EVENT_TYPE_AREAS)[number];
