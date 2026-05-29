// Status-tone маппинг для Errand-runs страниц. Делегирует единому
// runStatusTone, чтобы `succeeded`/`success` и прочие словари run-типов давали
// один и тот же цвет (баг: раньше `succeeded` оставался серым).

import type { ErrandRunStatus } from '../../api/keeper';
import { runStatusTone } from '../../components/status';

export function errandRunStatusTone(
  s: ErrandRunStatus | string | undefined,
): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  return runStatusTone(s);
}

export const ERRAND_RUN_TERMINAL: ReadonlySet<string> = new Set([
  'success',
  'partial_failed',
  'failed',
  'cancelled',
]);
