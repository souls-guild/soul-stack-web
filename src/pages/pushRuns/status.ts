// Status-tone mappings for Push-runs pages. Extracted from PushRunsList.tsx due to
// the react-refresh rule (only components in a page file). Delegates to the shared
// runStatusTone (common dictionary for all run types).

import { runStatusTone } from '../../components/status';

export function pushStatusTone(s: string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  return runStatusTone(s);
}
