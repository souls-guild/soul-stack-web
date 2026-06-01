import type { ServiceScenarioInfo } from '../../api/keeper';

/** Lifecycle-сценарий — keeper трактует его особо (create/destroy/converge).
 *  Проверяем по полю `kind`, которое backend отдаёт в GET /v1/services/{name}/scenarios.
 */
export function isLifecycleScenario(scenario: ServiceScenarioInfo): boolean {
  return scenario.kind === 'lifecycle';
}

/** Фильтр: только operational-сценарии (не lifecycle). */
export function runnableScenarios(items: ServiceScenarioInfo[]): ServiceScenarioInfo[] {
  return items.filter((s) => !isLifecycleScenario(s));
}
