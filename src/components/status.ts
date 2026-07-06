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
//   ok    — терминально-успешные: success / succeeded / completed / no_match
//           (no_match — benign-терминал apply_run: сценарий не адресовал хост)
//   warn  — частичный успех: partial / partial_failed
//   danger— неуспешные терминалы: failed / error / error_locked / aborted /
//           timed_out / module_not_allowed / orphaned (apply_run: хост-строка
//           осиротела без финального RunResult)
//   info  — в процессе: running / pending / claimed / planned / applying /
//           dispatched (apply_run: задача отправлена Soul-у, ответ не пришёл)
//   muted — отменён / неизвестный: cancelled / прочее
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

// Per-task status→tone (NIM-37). Wire-значение — proto TaskStatus.String():
// TASK_STATUS_OK|CHANGED|FAILED|TIMED_OUT|SKIPPED|CANCELLED (SSE `task_status`,
// audit `status` — одна нормализация). Матч по contains: устойчив к префиксу и
// к возможному bare-значению.
export function taskStatusTone(status: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  const s = (status ?? '').toUpperCase();
  if (s.includes('FAILED') || s.includes('TIMED_OUT')) return 'danger';
  if (s.includes('CANCELLED') || s.includes('SKIPPED')) return 'muted';
  // CHANGED — янтарный (Ansible-конвенция: изменение = attention, не neutral-info).
  if (s.includes('CHANGED')) return 'warn';
  if (s.includes('OK')) return 'ok';
  return 'muted';
}
