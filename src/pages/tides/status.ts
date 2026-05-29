// Status-tone маппинги для Tide-страниц. Вынесено из TidesList.tsx из-за
// react-refresh правила (только-компоненты в файле страницы). Делегирует единому
// runStatusTone (общий словарь всех run-типов; tide отдаёт `succeeded`).

import { runStatusTone } from '../../components/status';

export function tideStatusTone(s: string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  return runStatusTone(s);
}
