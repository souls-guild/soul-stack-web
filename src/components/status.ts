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
