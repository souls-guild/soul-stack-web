// Typed-обёртки над Keeper Operator API. Соответствует docs/keeper/openapi.yaml.
//
// Типы импортируются из ./types.gen.ts (сгенерены `npm run gen:api`).
// До первой генерации файл types.gen.ts отсутствует — типы здесь
// объявлены минимально-достаточно, чтобы IDE/tsc не падали.

import { apiGet, apiSend } from './client';

// --- minimal manual mirror of openapi schemas ---
// Эти типы дублируют части openapi.yaml до запуска gen:api. После
// генерации Keeper-openapi → types.gen.ts можно переключиться на
// `import type { paths, components } from './types.gen'`. Сейчас держим
// узкий ручной surface, чтобы код собирался даже без node_modules.

export type IncarnationStatus =
  | 'provisioning'
  | 'ready'
  | 'applying'
  | 'error_locked'
  | 'migration_failed'
  | 'drift'
  | 'destroying'
  | 'destroy_failed';

export type SoulTransport = 'agent' | 'ssh';

export type SoulStatus = 'pending' | 'connected' | 'disconnected' | 'expired';

export interface IncarnationSummary {
  name: string;
  service: string;
  service_version: string;
  state_schema_version: number;
  covens: string[];
  spec?: Record<string, unknown>;
  state?: Record<string, unknown>;
  status: IncarnationStatus;
  status_details?: Record<string, unknown> | null;
  created_by_aid: string;
  created_at: string;
  updated_at: string;
  last_drift_check_at?: string | null;
  last_drift_summary?: {
    hosts_drifted: number;
    hosts_clean: number;
    hosts_unsupported: number;
    hosts_failed: number;
    total_hosts: number;
    scanned_at: string;
  } | null;
}

export interface IncarnationListReply {
  items: IncarnationSummary[];
  offset: number;
  limit: number;
  total: number;
}

export interface StateHistoryEntry {
  apply_id: string;
  scenario: string;
  status_before: IncarnationStatus;
  status_after: IncarnationStatus;
  changed_by_aid: string;
  started_at: string;
  finished_at?: string | null;
  state_before?: Record<string, unknown>;
  state_after?: Record<string, unknown>;
}

export interface IncarnationHistoryReply {
  items: StateHistoryEntry[];
  offset: number;
  limit: number;
  total: number;
}

export interface DriftReport {
  apply_id: string;
  scenario: string;
  scanned_at: string;
  hosts: Array<{
    sid: string;
    outcome: 'drifted' | 'clean' | 'unsupported' | 'failed';
    drift_count?: number;
    error?: string;
  }>;
  counts: {
    hosts_drifted: number;
    hosts_clean: number;
    hosts_unsupported: number;
    hosts_failed: number;
  };
}

export interface SoulListEntry {
  sid: string;
  transport: SoulTransport;
  status: SoulStatus;
  covens?: string[];
  last_seen_at?: string;
  last_seen_by_kid?: string;
  registered_at: string;
}

export interface SoulListReply {
  items: SoulListEntry[];
  offset: number;
  limit: number;
  total: number;
}

// --- API ---

export interface ListIncarnationsQuery {
  service?: string;
  status?: IncarnationStatus;
  offset?: number;
  limit?: number;
}

export const keeperApi = {
  // health-probe, удобно использовать как «токен валиден?» (через /v1/incarnations).
  ping: () => apiGet<IncarnationListReply>('/v1/incarnations', { query: { limit: 1 } }),

  incarnations: {
    list: (q: ListIncarnationsQuery = {}) =>
      apiGet<IncarnationListReply>('/v1/incarnations', {
        query: { service: q.service, status: q.status, offset: q.offset, limit: q.limit },
      }),
    get: (name: string) => apiGet<IncarnationSummary>(`/v1/incarnations/${encodeURIComponent(name)}`),
    history: (name: string, q: { offset?: number; limit?: number } = {}) =>
      apiGet<IncarnationHistoryReply>(`/v1/incarnations/${encodeURIComponent(name)}/history`, {
        query: { offset: q.offset, limit: q.limit },
      }),
    checkDrift: (name: string) =>
      apiSend<DriftReport>(`/v1/incarnations/${encodeURIComponent(name)}/check-drift`, 'POST'),
  },

  souls: {
    list: (q: { coven?: string[]; status?: SoulStatus; transport?: SoulTransport; offset?: number; limit?: number } = {}) =>
      apiGet<SoulListReply>('/v1/souls', {
        query: {
          coven: q.coven,
          status: q.status,
          transport: q.transport,
          offset: q.offset,
          limit: q.limit,
        },
      }),
  },
};
