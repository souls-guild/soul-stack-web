import type { ServiceScenarioInfo } from '../../api/keeper';

/** Lifecycle-сценарий — keeper трактует его особо (create/destroy/converge).
 *  Проверяем по полю `kind`, которое backend отдаёт в GET /v1/services/{name}/scenarios.
 */
export function isLifecycleScenario(scenario: ServiceScenarioInfo): boolean {
  return scenario.kind === 'lifecycle';
}

/**
 * Фильтр: сценарии, запускаемые оператором из Run-формы.
 * Фильтрует по полю `runnable` (ADR-042 — «тупой фронт»): backend задаёт
 * runnable=true для create/converge/operational, runnable=false для destroy.
 * Fallback: если поле отсутствует (старый backend) — показываем все не-lifecycle.
 */
export function runnableScenarios(items: ServiceScenarioInfo[]): ServiceScenarioInfo[] {
  return items.filter((s) => s.runnable ?? !isLifecycleScenario(s));
}
