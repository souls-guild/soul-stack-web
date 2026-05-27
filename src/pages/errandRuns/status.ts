// Status-tone маппинг для Errand-runs страниц.

import type { ErrandRunStatus } from '../../api/keeper';

export function errandRunStatusTone(
  s: ErrandRunStatus | string | undefined,
): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success':
      return 'ok';
    case 'partial_failed':
      return 'warn';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'muted';
    case 'pending':
    case 'running':
      return 'info';
    default:
      return 'muted';
  }
}

export const ERRAND_RUN_TERMINAL: ReadonlySet<string> = new Set([
  'success',
  'partial_failed',
  'failed',
  'cancelled',
]);
