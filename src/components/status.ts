import type { DotKind } from './primitives';
import type { IncarnationStatus, SoulStatus } from '../api/keeper';

export function incarnationDot(status: IncarnationStatus): DotKind {
  switch (status) {
    case 'ready':
      return 'ok';
    case 'applying':
    case 'provisioning':
    case 'destroying':
      return 'info';
    case 'drift':
      return 'warn';
    case 'error_locked':
    case 'migration_failed':
    case 'destroy_failed':
      return 'off';
    default:
      return 'idle';
  }
}

export function soulDot(status: SoulStatus): DotKind {
  switch (status) {
    case 'connected':
      return 'ok';
    case 'pending':
      return 'idle';
    case 'disconnected':
    case 'expired':
      return 'off';
    default:
      return 'idle';
  }
}

export function incarnationTone(status: IncarnationStatus): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'ready':
      return 'ok';
    case 'drift':
      return 'warn';
    case 'error_locked':
    case 'migration_failed':
    case 'destroy_failed':
      return 'danger';
    case 'applying':
    case 'provisioning':
    case 'destroying':
      return 'info';
    default:
      return 'muted';
  }
}

export function soulTone(status: SoulStatus): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'connected':
      return 'ok';
    case 'disconnected':
    case 'expired':
      return 'danger';
    case 'pending':
      return 'muted';
    default:
      return 'muted';
  }
}

// Unified status->tone mapping for ALL run types (Tide / Push / Errand-run /
// Errand). Run types use a different vocabulary of terminal statuses: tide returns
// `succeeded`, push/errand-run/errand return `success`; this helper equalizes both
// (as well as `completed` from push.cleanup-shape) into one green tone, so the badge
// is consistent in the combined /runs feed and on per-type pages.
//
// Groups (values collected from the openapi enums of all list-endpoints):
//   ok    - terminally successful: success / succeeded / completed / no_match
//           (no_match - benign terminal of apply_run: the scenario didn't address a host)
//   warn  - partial success: partial / partial_failed
//   danger- unsuccessful terminals: failed / error / error_locked / aborted /
//           timed_out / module_not_allowed / orphaned (apply_run: the host-row
//           was orphaned without a final RunResult)
//   info  - in progress: running / pending / claimed / planned / applying /
//           dispatched (apply_run: task sent to the Soul, no response yet)
//   muted - cancelled / unknown: cancelled / other
export function runStatusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'no_match':
      return 'ok';
    case 'partial':
    case 'partial_failed':
      return 'warn';
    case 'failed':
    case 'error':
    case 'error_locked':
    case 'aborted':
    case 'timed_out':
    case 'module_not_allowed':
    case 'orphaned':
      return 'danger';
    case 'running':
    case 'pending':
    case 'scheduled':
    case 'claimed':
    case 'planned':
    case 'applying':
    case 'dispatched':
      return 'info';
    case 'cancelled':
      return 'muted';
    default:
      return 'muted';
  }
}

// Per-task status->tone (NIM-37). Wire value is proto TaskStatus.String():
// TASK_STATUS_OK|CHANGED|FAILED|TIMED_OUT|SKIPPED|CANCELLED (SSE `task_status`,
// audit `status` - one normalization). Match by contains: resilient to a prefix and
// to a possible bare value.
export function taskStatusTone(status: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  const s = (status ?? '').toUpperCase();
  if (s.includes('FAILED') || s.includes('TIMED_OUT')) return 'danger';
  if (s.includes('CANCELLED') || s.includes('SKIPPED')) return 'muted';
  // CHANGED - amber (a change = attention, not neutral-info).
  if (s.includes('CHANGED')) return 'warn';
  if (s.includes('OK')) return 'ok';
  return 'muted';
}
