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

// Единый status→tone-маппинг для ВСЕХ run-типов (Tide / Push / Errand-run /
// Errand). Run-типы используют разный словарь терминальных статусов: tide отдаёт
// `succeeded`, push/errand-run/errand — `success`; этот хелпер уравнивает оба
// (а также `completed` из push.cleanup-shape) в один зелёный tone, чтобы бейдж
// был консистентным в сводной ленте /runs и на per-type-страницах.
//
// Группы (значения собраны из openapi-enum-ов всех list-эндпоинтов):
//   ok    — терминально-успешные: success / succeeded / completed
//   warn  — частичный успех: partial / partial_failed
//   danger— неуспешные терминалы: failed / error / error_locked / aborted /
//           timed_out / module_not_allowed
//   info  — в процессе: running / pending / claimed / planned / applying
//   muted — отменён / неизвестный: cancelled / прочее
export function runStatusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success':
    case 'succeeded':
    case 'completed':
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
      return 'danger';
    case 'running':
    case 'pending':
    case 'claimed':
    case 'planned':
    case 'applying':
      return 'info';
    case 'cancelled':
      return 'muted';
    default:
      return 'muted';
  }
}
