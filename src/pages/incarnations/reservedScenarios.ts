import type { ServiceScenarioInfo } from '../../api/keeper';

/** Lifecycle scenario - keeper treats it specially (create/destroy/converge).
 *  Checked by the `kind` field, which the backend returns in GET /v1/services/{name}/scenarios.
 */
export function isLifecycleScenario(scenario: ServiceScenarioInfo): boolean {
  return scenario.kind === 'lifecycle';
}

/**
 * Filter: scenarios runnable by an operator from the Run form.
 * Filters by the `runnable` field (ADR-042 - "dumb frontend"): the backend sets
 * runnable=true for create/converge/operational, runnable=false for destroy.
 * Fallback: if the field is absent (old backend) - show all non-lifecycle scenarios.
 */
export function runnableScenarios(items: ServiceScenarioInfo[]): ServiceScenarioInfo[] {
  return items.filter((s) => s.runnable ?? !isLifecycleScenario(s));
}
