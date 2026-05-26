// Typed-обёртки над Keeper Operator API. Соответствует vendor/openapi/keeper.yaml.
//
// Типы импортируются из ./types.gen.ts (сгенерены `npm run gen:api`).
// types.gen.ts в .gitignore — сгенерится локально; до первого `npm run gen:api`
// узкая часть типов продублирована вручную (минимальный fallback).

import { apiGet, apiSend, ApiError } from './client';
import { tokenStore } from './tokenStore';
import type { components } from './types.gen';

// --- Re-export из generated openapi (источник правды) ---

export type IncarnationStatus = components['schemas']['IncarnationStatus'];
export type SoulTransport = components['schemas']['SoulTransport'];
export type SoulStatus = components['schemas']['SoulStatus'];

// IncarnationGetReply — единая проекция incarnation (используется и в list, и в get).
// Старое имя IncarnationSummary оставлено как alias для обратной совместимости.
export type IncarnationGetReply = components['schemas']['IncarnationGetReply'];
export type IncarnationSummary = IncarnationGetReply;
export type IncarnationListReply = components['schemas']['IncarnationListReply'];
export type StateHistoryEntry = components['schemas']['StateHistoryEntry'];
export type IncarnationHistoryReply = components['schemas']['IncarnationHistoryReply'];
export type DriftReport = components['schemas']['DriftReport'];

export type SoulListEntry = components['schemas']['SoulListEntry'];
export type SoulListReply = components['schemas']['SoulListReply'];
export type SoulprintReadReply = components['schemas']['SoulprintReadReply'];
export type SoulprintFacts = components['schemas']['SoulprintFacts'];
export type SoulprintOsFacts = components['schemas']['SoulprintOsFacts'];
export type SoulprintKernelFacts = components['schemas']['SoulprintKernelFacts'];
export type SoulprintCpuFacts = components['schemas']['SoulprintCpuFacts'];
export type SoulprintMemoryFacts = components['schemas']['SoulprintMemoryFacts'];
export type SoulprintNetworkFacts = components['schemas']['SoulprintNetworkFacts'];
export type SoulprintNetworkInterface = components['schemas']['SoulprintNetworkInterface'];

export type OperatorCreateRequest = components['schemas']['OperatorCreateRequest'];
export type OperatorCreateReply = components['schemas']['OperatorCreateReply'];
export type OperatorRevokeRequest = components['schemas']['OperatorRevokeRequest'];
export type IssueTokenReply = components['schemas']['IssueTokenReply'];
export type Operator = components['schemas']['Operator'];
export type OperatorListReply = components['schemas']['OperatorListReply'];
export type OperatorAuthMethod = NonNullable<Operator['auth_method']>;

export type AuditEvent = components['schemas']['AuditEvent'];
export type AuditEventListReply = components['schemas']['AuditEventListReply'];
export type AuditEventSource = NonNullable<AuditEvent['source']>;

export type PushApplyRequest = components['schemas']['PushApplyRequest'];
export type PushApplyReply = components['schemas']['PushApplyReply'];
export type PushApplyView = components['schemas']['PushApplyView'];

export type ErrandRunRequest = components['schemas']['ErrandRunRequest'];
export type ErrandAccepted = components['schemas']['ErrandAccepted'];
export type ErrandResult = components['schemas']['ErrandResult'];
export type ErrandListReply = components['schemas']['ErrandListReply'];
export type ErrandStatus = NonNullable<ErrandResult['status']>;

// --- Public-thrown error для случая GetSoulprint → 410 «не приходил». ---

export class SoulprintNotReceivedError extends Error {
  constructor(public sid: string) {
    super(`soulprint ещё не получен для ${sid}`);
    this.name = 'SoulprintNotReceivedError';
  }
}

// --- API ---

export interface ListIncarnationsQuery {
  service?: string;
  status?: IncarnationStatus;
  coven?: string;
  offset?: number;
  limit?: number;
}

export interface ListSoulsQuery {
  coven?: string[];
  status?: SoulStatus;
  transport?: SoulTransport;
  offset?: number;
  limit?: number;
}

export const keeperApi = {
  // health-probe, удобно использовать как «токен валиден?» (через /v1/incarnations).
  ping: () => apiGet<IncarnationListReply>('/v1/incarnations', { query: { limit: 1 } }),

  incarnations: {
    list: (q: ListIncarnationsQuery = {}) =>
      apiGet<IncarnationListReply>('/v1/incarnations', {
        query: {
          service: q.service,
          status: q.status,
          coven: q.coven,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (name: string) =>
      apiGet<IncarnationGetReply>(`/v1/incarnations/${encodeURIComponent(name)}`),
    history: (name: string, q: { offset?: number; limit?: number } = {}) =>
      apiGet<IncarnationHistoryReply>(`/v1/incarnations/${encodeURIComponent(name)}/history`, {
        query: { offset: q.offset, limit: q.limit },
      }),
    checkDrift: (name: string) =>
      apiSend<DriftReport>(`/v1/incarnations/${encodeURIComponent(name)}/check-drift`, 'POST'),
  },

  souls: {
    list: (q: ListSoulsQuery = {}) =>
      apiGet<SoulListReply>('/v1/souls', {
        query: {
          coven: q.coven,
          status: q.status,
          transport: q.transport,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (sid: string) => apiGet<SoulListEntry>(`/v1/souls/${encodeURIComponent(sid)}`),
    // 410 → SoulprintNotReceivedError (запись Soul есть, фактов ещё не приходило).
    // Прочие ошибки пробрасываются как ApiError.
    getSoulprint: async (sid: string): Promise<SoulprintReadReply> => {
      try {
        return await apiGet<SoulprintReadReply>(
          `/v1/souls/${encodeURIComponent(sid)}/soulprint`,
        );
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 410
        ) {
          throw new SoulprintNotReceivedError(sid);
        }
        throw err;
      }
    },
    // POST /v1/souls/{sid}/exec. 200 → ErrandResult (sync), 202 → ErrandAccepted (async).
    // Возвращаем discriminated union — caller сам решает, polling или render.
    exec: async (
      sid: string,
      body: ErrandRunRequest,
    ): Promise<{ kind: 'sync'; result: ErrandResult } | { kind: 'async'; accepted: ErrandAccepted }> => {
      const res = await fetch(`/v1/souls/${encodeURIComponent(sid)}/exec`, {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let problem: { type?: string; title?: string; detail?: string } = {};
        try { problem = await res.json(); } catch { /* empty */ }
        if (res.status === 401) tokenStoreClear();
        throw new ApiError(res.status, problem.type ?? 'about:blank', problem.title ?? res.statusText, problem.detail ?? '');
      }
      const payload = (await res.json()) as ErrandResult | ErrandAccepted;
      if (res.status === 202) {
        return { kind: 'async', accepted: payload as ErrandAccepted };
      }
      return { kind: 'sync', result: payload as ErrandResult };
    },
  },

  errands: {
    list: (q: ListErrandsQuery = {}) =>
      apiGet<ErrandListReply>('/v1/errands', {
        query: {
          sid: q.sid,
          status: q.status,
          started_after: q.started_after,
          module: q.module,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    // 200 → ErrandResult, 202 → ErrandAccepted. По status различаем без HTTP-кода.
    get: (errandId: string) =>
      apiGet<ErrandResult | ErrandAccepted>(`/v1/errands/${encodeURIComponent(errandId)}`),
  },

  audit: {
    list: (q: ListAuditQuery = {}) =>
      apiGet<AuditEventListReply>('/v1/audit', {
        query: {
          type: q.type,
          source: q.source,
          archon_aid: q.archon_aid,
          correlation_id: q.correlation_id,
          started_after: q.started_after,
          started_before: q.started_before,
          offset: q.offset,
          limit: q.limit,
        },
      }),
  },

  push: {
    // 202 → PushApplyReply.
    apply: (body: PushApplyRequest) =>
      apiSend<PushApplyReply>('/v1/push/apply', 'POST', { body }),
    get: (applyId: string) => apiGet<PushApplyView>(`/v1/push/${encodeURIComponent(applyId)}`),
  },

  operators: {
    // 200 → OperatorListReply (paged + auth_method/revoked фильтры).
    list: (q: ListOperatorsQuery = {}) =>
      apiGet<OperatorListReply>('/v1/operators', {
        query: {
          auth_method: q.auth_method,
          revoked: q.revoked,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    // 200 → Operator (detail).
    get: (aid: string) => apiGet<Operator>(`/v1/operators/${encodeURIComponent(aid)}`),
    // 201 → OperatorCreateReply (включая jwt — отдаётся один раз).
    create: (body: OperatorCreateRequest) =>
      apiSend<OperatorCreateReply>('/v1/operators', 'POST', { body }),
    // 204 — body не возвращается.
    revoke: (aid: string, body: OperatorRevokeRequest = {}) =>
      apiSend<void>(`/v1/operators/${encodeURIComponent(aid)}/revoke`, 'POST', { body }),
    // 200 → IssueTokenReply (jwt отдаётся один раз).
    issueToken: (aid: string) =>
      apiSend<IssueTokenReply>(`/v1/operators/${encodeURIComponent(aid)}/issue-token`, 'POST'),
  },
};

// --- helper-ы для discriminated union 200/202 на /v1/souls/{sid}/exec ---

function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function tokenStoreClear(): void {
  tokenStore.clear();
}

export interface ListErrandsQuery {
  sid?: string;
  status?: ErrandStatus;
  started_after?: string;
  // Multi-value `?module=X&module=Y` — exact-match OR (openapi commit 157ee27).
  module?: string[];
  offset?: number;
  limit?: number;
}

export interface ListAuditQuery {
  // Multi-value type/source — exact-match OR.
  type?: string[];
  source?: AuditEventSource[];
  archon_aid?: string;
  correlation_id?: string;
  // RFC3339, обе границы включающие (см. openapi.yaml).
  started_after?: string;
  started_before?: string;
  offset?: number;
  limit?: number;
}

export interface ListOperatorsQuery {
  auth_method?: OperatorAuthMethod;
  // Default server-side = false (только активные). true — включая revoked.
  revoked?: boolean;
  offset?: number;
  limit?: number;
}
