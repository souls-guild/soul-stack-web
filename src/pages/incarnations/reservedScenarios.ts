import type { ServiceScenarioInfo } from '../../api/keeper';

// Зарезервированные lifecycle / служебные имена сценариев, которые НЕ являются
// «обычными операционными сценариями для запуска» и не должны попадать в
// scenario-picker-ы выбора-для-запуска (Run Wizard) и в форму создания incarnation:
//   - create  — вызывается неявно через POST /v1/incarnations;
//   - destroy — вызывается через action «Destroy» в шапке incarnation;
//   - converge — Scry drift-detect (read-only проверка дрифта), доступен через
//     отдельное действие «Check drift» на вкладке Drift, а не как запускаемый scenario.
// Операционные сценарии (restart / add_replica / update_acl / add_user / …) — показываются.
export const RESERVED_SCENARIO_NAMES = new Set(['create', 'destroy', 'converge']);

export function isReservedScenario(name: string): boolean {
  return RESERVED_SCENARIO_NAMES.has(name);
}

export function runnableScenarios(items: ServiceScenarioInfo[]): ServiceScenarioInfo[] {
  return items.filter((s) => !isReservedScenario(s.name));
}
