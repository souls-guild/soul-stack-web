// Status-tone маппинги для Push-runs страниц. Вынесено из PushRunsList.tsx из-за
// react-refresh правила (только-компоненты в файле страницы). Делегирует единому
// runStatusTone (общий словарь всех run-типов).

import { runStatusTone } from '../../components/status';

export function pushStatusTone(s: string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  return runStatusTone(s);
}
