// Status-tone маппинги для Push-runs страниц. Вынесено из PushRunsList.tsx из-за
// react-refresh правила (только-компоненты в файле страницы).

export function pushStatusTone(s: string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
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
