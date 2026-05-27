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
export type IncarnationCreateRequest = components['schemas']['IncarnationCreateRequest'];
export type IncarnationCreateReply = components['schemas']['IncarnationCreateReply'];
export type IncarnationRunRequest = components['schemas']['IncarnationRunRequest'];
export type IncarnationRunReply = components['schemas']['IncarnationRunReply'];
export type IncarnationUnlockRequest = components['schemas']['IncarnationUnlockRequest'];
export type IncarnationUnlockReply = components['schemas']['IncarnationUnlockReply'];
export type IncarnationUpgradeRequest = components['schemas']['IncarnationUpgradeRequest'];
export type IncarnationUpgradeReply = components['schemas']['IncarnationUpgradeReply'];
export type IncarnationDestroyReply = components['schemas']['IncarnationDestroyReply'];
export type IncarnationCheckDriftRequest = components['schemas']['IncarnationCheckDriftRequest'];

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

export type RoleView = components['schemas']['RoleView'];
export type RoleListReply = components['schemas']['RoleListReply'];
export type RoleCreateRequest = components['schemas']['RoleCreateRequest'];
export type RolePermissionsUpdateRequest = components['schemas']['RolePermissionsUpdateRequest'];
export type GrantOperatorRequest = components['schemas']['GrantOperatorRequest'];

export type ServiceView = components['schemas']['ServiceView'];
export type ServiceListReply = components['schemas']['ServiceListReply'];
export type ServiceRegisterRequest = components['schemas']['ServiceRegisterRequest'];
export type ServiceUpdateRequest = components['schemas']['ServiceUpdateRequest'];

// Oracle: Vigil (Soul-side проверка beacons) + Decree (reactor-правило). ADR-030.
export type VigilCreateRequest = components['schemas']['VigilCreateRequest'];
export type VigilView = components['schemas']['VigilView'];
export type VigilListReply = components['schemas']['VigilListReply'];
export type DecreeCreateRequest = components['schemas']['DecreeCreateRequest'];
export type DecreeView = components['schemas']['DecreeView'];
export type DecreeListReply = components['schemas']['DecreeListReply'];

export type PluginSigilView = components['schemas']['PluginSigilView'];
export type PluginSigilListReply = components['schemas']['PluginSigilListReply'];
export type PluginSigilAllowRequest = components['schemas']['PluginSigilAllowRequest'];
export type PluginSigilAllowReply = components['schemas']['PluginSigilAllowReply'];

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
    create: (body: IncarnationCreateRequest) =>
      apiSend<IncarnationCreateReply>('/v1/incarnations', 'POST', { body }),
    runScenario: (name: string, scenario: string, body: IncarnationRunRequest = {}) =>
      apiSend<IncarnationRunReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/scenarios/${encodeURIComponent(scenario)}`,
        'POST',
        { body },
      ),
    history: (name: string, q: { offset?: number; limit?: number } = {}) =>
      apiGet<IncarnationHistoryReply>(`/v1/incarnations/${encodeURIComponent(name)}/history`, {
        query: { offset: q.offset, limit: q.limit },
      }),
    checkDrift: (name: string, body: IncarnationCheckDriftRequest = {}) =>
      apiSend<DriftReport>(
        `/v1/incarnations/${encodeURIComponent(name)}/check-drift`,
        'POST',
        { body },
      ),
    unlock: (name: string, body: IncarnationUnlockRequest) =>
      apiSend<IncarnationUnlockReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/unlock`,
        'POST',
        { body },
      ),
    upgrade: (name: string, body: IncarnationUpgradeRequest) =>
      apiSend<IncarnationUpgradeReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/upgrade`,
        'POST',
        { body },
      ),
    // DELETE /v1/incarnations/{name}?allow_destroy=<bool>. allow_destroy=true →
    // снос без teardown (force), false → штатный через scenario `destroy`.
    destroy: (name: string, allowDestroy: boolean) =>
      apiSend<IncarnationDestroyReply>(
        `/v1/incarnations/${encodeURIComponent(name)}`,
        'DELETE',
        { query: { allow_destroy: allowDestroy } },
      ),
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

  roles: {
    list: () => apiGet<RoleListReply>('/v1/roles'),
    create: (body: RoleCreateRequest) =>
      apiSend<void>('/v1/roles', 'POST', { body }),
    delete: (name: string) =>
      apiSend<void>(`/v1/roles/${encodeURIComponent(name)}`, 'DELETE'),
    updatePermissions: (name: string, body: RolePermissionsUpdateRequest) =>
      apiSend<void>(`/v1/roles/${encodeURIComponent(name)}/permissions`, 'PATCH', { body }),
    grantOperator: (name: string, body: GrantOperatorRequest) =>
      apiSend<void>(`/v1/roles/${encodeURIComponent(name)}/operators`, 'POST', { body }),
    revokeOperator: (name: string, aid: string) =>
      apiSend<void>(
        `/v1/roles/${encodeURIComponent(name)}/operators/${encodeURIComponent(aid)}`,
        'DELETE',
      ),
  },

  services: {
    list: () => apiGet<ServiceListReply>('/v1/services'),
    get: (name: string) =>
      apiGet<ServiceView>(`/v1/services/${encodeURIComponent(name)}`),
    register: (body: ServiceRegisterRequest) =>
      apiSend<ServiceView>('/v1/services', 'POST', { body }),
    update: (name: string, body: ServiceUpdateRequest) =>
      apiSend<ServiceView>(`/v1/services/${encodeURIComponent(name)}`, 'PATCH', { body }),
    deregister: (name: string) =>
      apiSend<void>(`/v1/services/${encodeURIComponent(name)}`, 'DELETE'),
  },

  // Oracle: Vigil-реестр (Soul-side проверки beacons). ADR-030.
  vigils: {
    list: (q: ListPagedQuery = {}) =>
      apiGet<VigilListReply>('/v1/vigils', {
        query: { offset: q.offset, limit: q.limit },
      }),
    get: (name: string) =>
      apiGet<VigilView>(`/v1/vigils/${encodeURIComponent(name)}`),
    create: (body: VigilCreateRequest) =>
      apiSend<VigilView>('/v1/vigils', 'POST', { body }),
    delete: (name: string) =>
      apiSend<void>(`/v1/vigils/${encodeURIComponent(name)}`, 'DELETE'),
  },

  // Oracle: Decree-реестр (reactor-правила). ADR-030.
  decrees: {
    list: (q: ListPagedQuery = {}) =>
      apiGet<DecreeListReply>('/v1/decrees', {
        query: { offset: q.offset, limit: q.limit },
      }),
    get: (name: string) =>
      apiGet<DecreeView>(`/v1/decrees/${encodeURIComponent(name)}`),
    create: (body: DecreeCreateRequest) =>
      apiSend<DecreeView>('/v1/decrees', 'POST', { body }),
    delete: (name: string) =>
      apiSend<void>(`/v1/decrees/${encodeURIComponent(name)}`, 'DELETE'),
  },

  // Sigil-allow-list плагинов (ADR-026, вариант C). Полный путь записи — (namespace, name, ref).
  plugins: {
    sigils: {
      // 200 → PluginSigilListReply. Только активные допуски, новые первыми.
      list: () => apiGet<PluginSigilListReply>('/v1/plugins/sigils'),
      // 201 → PluginSigilAllowReply. Keeper читает бинарь/manifest из локального
      // кеша host-а по (namespace, name); sha256 считается Keeper-ом, не клиентом.
      allow: (body: PluginSigilAllowRequest) =>
        apiSend<PluginSigilAllowReply>('/v1/plugins/sigils', 'POST', { body }),
      // 204 — мягкая ревокация. ref — одиночный path-сегмент (tag-ref вида v1.2.3).
      revoke: (namespace: string, name: string, ref: string) =>
        apiSend<void>(
          `/v1/plugins/sigils/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(ref)}`,
          'DELETE',
        ),
    },
  },
};

export interface ListPagedQuery {
  offset?: number;
  limit?: number;
}

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
