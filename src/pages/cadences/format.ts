import { formatDistanceToNowStrict } from 'date-fns';
import type { Cadence } from '../../api/keeper';

export function relative(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

export function scheduleLabel(c: Cadence): string {
  if (c.schedule_kind === 'interval' && c.interval_seconds) {
    const s = c.interval_seconds;
    if (s % 3600 === 0) return `every ${s / 3600}h`;
    if (s % 60 === 0) return `every ${s / 60}m`;
    return `every ${s}s`;
  }
  if (c.schedule_kind === 'cron' && c.cron_expr) {
    return `cron: ${c.cron_expr}`;
  }
  return c.schedule_kind;
}
