// Status-tone маппинг для Soul-history timeline. Записи приходят из двух
// источников — scenario (apply_runs) и errand (errands), у каждого свой словарь
// статусов; общий мапер покрывает оба. Вынесено из SoulDetail.tsx (react-refresh:
// в файле страницы — только компоненты).

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

// Терминальные статусы — для решения «нужен ли polling». Всё, чего нет здесь,
// считается running (pending/running/applying/неизвестное-нетерминальное).
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
