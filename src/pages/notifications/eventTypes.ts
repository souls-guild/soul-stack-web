/**
 * Известные области event_types для Tiding-правил (ADR-052, S5).
 *
 * [NOTE: backend-каталога областей нет — это статический список кандидата на
 * ADR-042-каталог. Если/когда backend добавит эндпоинт GET /v1/event-types,
 * этот список заменяется фетчем, как требует ADR-042.]
 *
 * Список намеренно хранится в одном месте (этом файле) и не дублируется.
 *
 * TODO(ADR-042): заменить этот массив фетчем каталог-эндпоинта от backend-а,
 * когда он будет реализован. Хардкод — известный долг.
 */

export const KNOWN_EVENT_TYPE_AREAS = [
  'scenario_run.*',
  'command_run.*',
  'voyage.*',
  'cadence.*',
  'incarnation.drift_checked',
  // Итог прогона над инкарнацией (changed_tasks + cadence_id + status).
  // Используется в связке с полем task Tiding-правила для алертов на конкретную задачу.
  'incarnation.run_completed',
] as const;

export type KnownEventTypeArea = (typeof KNOWN_EVENT_TYPE_AREAS)[number];
