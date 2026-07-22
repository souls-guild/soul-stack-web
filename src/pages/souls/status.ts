// Status-tone mapping for the Soul-history timeline. Records come from two
// sources -- scenario (apply_runs) and errand (errands), each with its own status
// vocabulary; the shared mapper covers both. Extracted from SoulDetail.tsx (react-refresh:
// the page file should contain only components).

export function soulHistoryStatusTone(
  s: string | undefined,
): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success':
    case 'succeeded':
    case 'changed':
    case 'ok':
      return 'ok';
    case 'partial_failed':
    case 'drift':
      return 'warn';
    case 'failed':
    case 'error':
    case 'timed_out':
    case 'module_not_allowed':
      return 'danger';
    case 'cancelled':
      return 'muted';
    case 'pending':
    case 'running':
    case 'applying':
      return 'info';
    default:
      return 'muted';
  }
}

// Terminal statuses -- for deciding whether polling is needed. Anything not here
// is treated as running (pending/running/applying/unknown-non-terminal).
const SOUL_HISTORY_TERMINAL: ReadonlySet<string> = new Set([
  'success',
  'succeeded',
  'changed',
  'ok',
  'partial_failed',
  'failed',
  'error',
  'timed_out',
  'module_not_allowed',
  'cancelled',
]);

export function soulHistoryIsRunning(status: string | undefined): boolean {
  if (!status) return false;
  return !SOUL_HISTORY_TERMINAL.has(status);
}
