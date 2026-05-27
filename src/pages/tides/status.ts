// Status-tone маппинги для Tide-страниц. Вынесено из TidesList.tsx из-за
// react-refresh правила (только-компоненты в файле страницы).

export function tideStatusTone(s: string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'succeeded':
      return 'ok';
    case 'failed':
      return 'danger';
    case 'partial_failed':
      return 'warn';
    case 'running':
    case 'pending':
      return 'info';
    case 'cancelled':
      return 'muted';
    default:
      return 'muted';
  }
}
