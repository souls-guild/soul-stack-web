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
// Tide-режим удалён (ADR-043 Voyage заменяет Tide); IncarnationRunTideReply не экспортируется.
export type IncarnationRunAnyReply = IncarnationRunReply;
export type IncarnationUnlockRequest = components['schemas']['IncarnationUnlockRequest'];
export type IncarnationUnlockReply = components['schemas']['IncarnationUnlockReply'];
export type IncarnationUpgradeRequest = components['schemas']['IncarnationUpgradeRequest'];
export type IncarnationUpgradeReply = components['schemas']['IncarnationUpgradeReply'];
export type IncarnationDestroyReply = components['schemas']['IncarnationDestroyReply'];
export type IncarnationCheckDriftRequest = components['schemas']['IncarnationCheckDriftRequest'];

export type SoulListEntry = components['schemas']['SoulListEntry'];
export type SoulListReply = components['schemas']['SoulListReply'];
export type SoulprintReadReply = components['schemas']['SoulprintReadReply'];
export type SoulIssueTokenReply = components['schemas']['SoulIssueTokenReply'];
export type SoulCreateRequest = components['schemas']['SoulCreateRequest'];
export type SoulCreateReply = components['schemas']['SoulCreateReply'];
export type SoulCovenAssignRequest = components['schemas']['SoulCovenAssignRequest'];
export type SoulCovenAssignReply = components['schemas']['SoulCovenAssignReply'];
export type SoulCovenAssignSelector = components['schemas']['SoulCovenAssignSelector'];
export type SoulHistoryReply = components['schemas']['SoulHistoryReply'];
export type SoulHistoryItem = components['schemas']['SoulHistoryItem'];
export type SoulHistoryType = NonNullable<SoulHistoryItem['type']>;
export type SoulprintFacts = components['schemas']['SoulprintFacts'];
export type SoulprintOsFacts = components['schemas']['SoulprintOsFacts'];
export type SoulprintKernelFacts = components['schemas']['SoulprintKernelFacts'];
export type SoulprintCpuFacts = components['schemas']['SoulprintCpuFacts'];
export type SoulprintMemoryFacts = components['schemas']['SoulprintMemoryFacts'];
export type SoulprintNetworkFacts = components['schemas']['SoulprintNetworkFacts'];
export type SoulprintNetworkInterface = components['schemas']['SoulprintNetworkInterface'];

// Расширение OperatorCreateRequest: опциональное `roles[]` — список имён ролей,
// в которые сразу зачислить нового Архонта. Поле появилось в backend slice
// «create-with-roles»; до его доезда сервер игнорирует поле (200), либо отвечает
// 404/501 на extended endpoint — UI деградирует к создаванию без ролей.
export type OperatorCreateRequest = components['schemas']['OperatorCreateRequest'] & {
  roles?: string[];
};
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
export type PushRunListReply = components['schemas']['PushRunListReply'];
export type PushRunListEntry = components['schemas']['PushRunListEntry'];
export type PushSummaryCounts = components['schemas']['PushSummaryCounts'];
export type PushRunStatus = NonNullable<PushRunListEntry['status']>;

// Tide-runs удалены из API (Voyage ADR-043 заменяет Tide, ADR-040 W-4 отозван).
// Типы не экспортируются; keeperApi.tides сохранён как заглушка до очистки страниц.

export type ErrandRunRequest = components['schemas']['ErrandRunRequest'];
export type ErrandAccepted = components['schemas']['ErrandAccepted'];
export type ErrandResult = components['schemas']['ErrandResult'];
export type ErrandListReply = components['schemas']['ErrandListReply'];
export type ErrandStatus = NonNullable<ErrandResult['status']>;

// Multi-target Errand (ErrandRun) — slice 2026-05-27 W1, openapi ещё не закоммичен.
// Узкие локальные типы; backend-shape согласован в delegation-ТЗ.
export type ErrandRunStatus = 'pending' | 'running' | 'success' | 'partial_failed' | 'failed' | 'cancelled';
export type ErrandRunOnFailure = 'abort' | 'continue';

export interface ErrandRunTarget {
  sids?: string[];
  coven?: string[];
  where?: string;
}

export interface ErrandRunCreateRequest {
  module: string;
  input?: Record<string, unknown>;
  timeout_seconds?: number;
  target: ErrandRunTarget;
  concurrency?: number;
  on_failure?: ErrandRunOnFailure;
}

// Запись об одном дочернем Errand в Summary (ErrandRunRef). errand_id пуст, если
// Spawner упал до создания row (NotConnected).
export interface ErrandRunRef {
  sid: string;
  status: string;
  errand_id?: string;
  error_code?: string;
}

// Агрегированный итог ErrandRun (jsonb-колонка `summary`). counts — плоские
// поля верхнего уровня, per-host список — `errands[]`.
export interface ErrandRunSummary {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  errands: ErrandRunRef[];
}

export interface ErrandRunView {
  errand_run_id: string;
  module: string;
  status: ErrandRunStatus;
  scope_size: number;
  current_done?: number;
  concurrency: number;
  on_failure: ErrandRunOnFailure;
  target: ErrandRunTarget;
  started_by_aid?: string;
  started_at: string;
  finished_at?: string;
  summary?: ErrandRunSummary;
}

export interface ErrandRunListEntry {
  errand_run_id: string;
  module: string;
  status: ErrandRunStatus;
  scope_size: number;
  current_done?: number;
  started_at: string;
  finished_at?: string;
  target_preview?: string;
}

export interface ErrandRunListReply {
  items: ErrandRunListEntry[];
  offset: number;
  limit: number;
  total: number;
}

export interface ErrandRunCreateReply {
  errand_run_id: string;
}

// Voyage — унифицированный батчевый прогон (ADR-043). Типы из gen (sources of truth).
export type VoyageStatus = NonNullable<components['schemas']['Voyage']['status']>;
export type VoyageKind = NonNullable<components['schemas']['Voyage']['kind']>;
export type VoyageOnFailure = NonNullable<components['schemas']['VoyageCreateRequest']['on_failure']>;
export type VoyageTarget = components['schemas']['VoyageTarget'];
export type VoyageCreateRequest = components['schemas']['VoyageCreateRequest'];
export type VoyageCreateReply = components['schemas']['VoyageCreateReply'];
export type VoyageSummary = components['schemas']['VoyageSummary'];
export type Voyage = components['schemas']['Voyage'];
export type VoyageListReply = components['schemas']['VoyageListReply'];
export type VoyageCancelReply = components['schemas']['VoyageCancelReply'];

export interface ListVoyagesQuery {
  kind?: VoyageKind;
  status?: VoyageStatus[];
  offset?: number;
  limit?: number;
}

// Push-providers (ADR-032 amendment 2026-05-26, S7-2). Узкие алиасы.
export type PushProvider = components['schemas']['PushProvider'];
export type PushProviderListReply = components['schemas']['PushProviderListReply'];

export type RoleView = components['schemas']['RoleView'];
export type RoleListReply = components['schemas']['RoleListReply'];
export type RoleCreateRequest = components['schemas']['RoleCreateRequest'];
export type RolePermissionsUpdateRequest = components['schemas']['RolePermissionsUpdateRequest'];
export type GrantOperatorRequest = components['schemas']['GrantOperatorRequest'];

// Каталог permissions (GET /v1/permissions, ADR-042).
// Типы берём из сгенерированного types.gen.ts (gen:api синхронизировал vendor/openapi).
export type PermissionAction = components['schemas']['PermissionAction'];
// PermissionCatalogItem — имя из схемы. PermissionResource — alias для компонентов.
export type PermissionCatalogItem = components['schemas']['PermissionCatalogItem'];
export type PermissionResource = PermissionCatalogItem;
export type PermissionCatalogReply = components['schemas']['PermissionCatalogReply'];

export type ServiceView = components['schemas']['ServiceView'];
export type ServiceListReply = components['schemas']['ServiceListReply'];
export type ServiceRegisterRequest = components['schemas']['ServiceRegisterRequest'];
export type ServiceUpdateRequest = components['schemas']['ServiceUpdateRequest'];

// state_schema-метаданные сервиса (UI Schema explorer). GET /v1/services/{name}/state-schema.
export type ServiceStateSchemaReply = components['schemas']['ServiceStateSchemaReply'];
export type StateSchemaMigration = components['schemas']['StateSchemaMigration'];

// Hosts-editing (PATCH /v1/incarnations/{name}/hosts).
export type IncarnationSpecHost = components['schemas']['IncarnationSpecHost'];
export type IncarnationUpdateHostsRequest = components['schemas']['IncarnationUpdateHostsRequest'];
export type IncarnationUpdateHostsMode = IncarnationUpdateHostsRequest['mode'];

// Choir + Voice (ADR-044). Топология хостов внутри инкарнации.
export type Choir = components['schemas']['Choir'];
export type Voice = components['schemas']['Voice'];
export type ChoirCreateRequest = components['schemas']['ChoirCreateRequest'];
export type VoiceAddRequest = components['schemas']['VoiceAddRequest'];
export type ChoirListReply = components['schemas']['ChoirListReply'];
export type VoiceListReply = components['schemas']['VoiceListReply'];

// Refs / scenarios endpoints ещё не зафиксированы в openapi (фиксируется параллельно
// в backend-slice-е). Локальные типы — узкий контракт, использующийся UI;
// graceful-degraded при 404/501.
export interface ServiceRefInfo {
  name: string;
  type: 'tag' | 'branch';
  commit?: string;
  is_default?: boolean;
}
export interface ServiceRefListReply {
  items: ServiceRefInfo[];
}

// input_schema — flat-map field→property (НЕ JSON-Schema-обёртка `{type:'object',properties}`).
// Каждое property несёт собственный `required: boolean` (per-field, не top-level массив).
// UI рендерит простые типы (string/integer/number/boolean) per-field; составные
// (array/object/oneOf/…) → fallback на JSON textarea.
// ADR-045 S4: pattern/format/source описывают UI-форму модуля (SID-picker, валидация).
export interface ScenarioInputSchemaProperty {
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  /** Regex-ограничение значения (ADR-045). */
  pattern?: string;
  /** Семантический формат строки (sid/hostname/…). */
  format?: string;
  /** Каталог-источник для SID-picker (ADR-045). */
  source?: ModuleInputSource;
  /**
   * Тип элемента списка (ADR-045 S8b). Присутствует для type=array.
   * Содержит вложенный ScenarioInputSchemaProperty (рекурсивно).
   * Для type=map/object: тип значения карты — при скалярном items.type
   * UI рисует KEY→VALUE-редактор; без items → JSON-textarea.
   */
  items?: ScenarioInputSchemaProperty;
  /** Поле = большое textarea, а не однострочный input (ADR-045 B3). */
  multiline?: boolean;
  /** Пример значения для placeholder (ADR-045 B3). */
  example?: string;
  /** Признак типа map (type=map нормализован): при скалярном items.type → KEY→VALUE-редактор. */
  isMap?: boolean;
  [key: string]: unknown;
}
export type ScenarioInputSchema = Record<string, ScenarioInputSchemaProperty>;

export interface ServiceScenarioInfo {
  name: string;
  // Backend отдаёт `scenario/<name>/main.yml` — read-only справочно.
  path?: string;
  /** Дискриминатор: lifecycle (create/destroy/converge) | operational. */
  kind: 'lifecycle' | 'operational';
  description?: string;
  input_schema?: ScenarioInputSchema;
}
// Backend-shape: `{ service, ref, scenarios: [...] }` (НЕ `{ items: [...] }`).
export interface ServiceScenarioListReply {
  service?: string;
  ref?: string;
  scenarios: ServiceScenarioInfo[];
}

// Oracle: Vigil (Soul-side проверка beacons) + Decree (reactor-правило). ADR-030.
export type VigilCreateRequest = components['schemas']['VigilCreateRequest'];
export type VigilView = components['schemas']['VigilView'];
export type VigilListReply = components['schemas']['VigilListReply'];
export type DecreeCreateRequest = components['schemas']['DecreeCreateRequest'];
export type DecreeView = components['schemas']['DecreeView'];
export type DecreeListReply = components['schemas']['DecreeListReply'];

// Module-каталог (GET /v1/modules, commit 530329d). core из coremod-реестра,
// plugin из активных plugin_sigils + manifest-params. Используется Run→Command
// module-search (замена free-text «custom module»).
export type ModuleCatalogItem = components['schemas']['ModuleCatalogItem'];
export type ModuleCatalogReply = components['schemas']['ModuleCatalogReply'];
export type ModuleParam = components['schemas']['ModuleParam'];
export type ModuleInputSource = components['schemas']['ModuleInputSource'];
export type ModuleKind = NonNullable<ModuleCatalogItem['kind']>;

// form-prep (ADR-045 S4): резолв live-SID по source (incarnation_hosts/choir) + prefix.
export interface ModuleFormPrepRequest {
  source: {
    incarnation_hosts?: string;
    choir?: { incarnation: string; name: string };
  };
  prefix?: string;
}
export interface ModuleFormPrepReply {
  sids: string[];
  truncated: boolean;
}

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
    // Поведение API: при наличии `wave` в request возвращается IncarnationRunTideReply,
    // иначе — classic IncarnationRunReply. Caller, использующий wave, должен сам сделать
    // type-narrowing по присутствию `tide_id`. Существующий /incarnations/:name → RunScenarioForm
    // вызывает БЕЗ wave и продолжает работать как было.
    // dryRun — только classic (не-Tide): добавляет `?dry_run=true` (canonical путь
    // soulctl). Backend объединяет query-флаг с body-полем по OR; шлём через query.
    runScenario: (
      name: string,
      scenario: string,
      body: IncarnationRunRequest = {},
      opts: { dryRun?: boolean } = {},
    ) =>
      apiSend<IncarnationRunReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/scenarios/${encodeURIComponent(scenario)}`,
        'POST',
        { body, query: opts.dryRun ? { dry_run: true } : undefined },
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
    // PATCH /v1/incarnations/{name}/hosts — правка declared spec.hosts[] (ADR-008).
    // mode=replace|append|remove. 200 → обновлённый incarnation. 422 unknown-SID,
    // 409 destroying/destroy_failed, 404 нет incarnation.
    updateHosts: (name: string, body: IncarnationUpdateHostsRequest) =>
      apiSend<IncarnationGetReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/hosts`,
        'PATCH',
        { body },
      ),
  },

  // Choir/Voice — топология хостов внутри инкарнации (ADR-044).
  choirs: {
    // GET /v1/incarnations/{name}/choirs → ChoirListReply (sorted by choir_name).
    list: (incarnationName: string) =>
      apiGet<ChoirListReply>(
        `/v1/incarnations/${encodeURIComponent(incarnationName)}/choirs`,
      ),
    // POST /v1/incarnations/{name}/choirs → 201 Choir.
    create: (incarnationName: string, body: ChoirCreateRequest) =>
      apiSend<Choir>(
        `/v1/incarnations/${encodeURIComponent(incarnationName)}/choirs`,
        'POST',
        { body },
      ),
    // DELETE /v1/incarnations/{name}/choirs/{choir} → 204 (CASCADE удаляет Voice-ы).
    delete: (incarnationName: string, choirName: string) =>
      apiSend<void>(
        `/v1/incarnations/${encodeURIComponent(incarnationName)}/choirs/${encodeURIComponent(choirName)}`,
        'DELETE',
      ),
    // GET .../choirs/{choir}/voices → VoiceListReply.
    listVoices: (incarnationName: string, choirName: string) =>
      apiGet<VoiceListReply>(
        `/v1/incarnations/${encodeURIComponent(incarnationName)}/choirs/${encodeURIComponent(choirName)}/voices`,
      ),
    // POST .../choirs/{choir}/voices {sid, role?, position?} → 201 Voice.
    // 422 ErrNotMembers если SID не является членом инкарнации.
    addVoice: (incarnationName: string, choirName: string, body: VoiceAddRequest) =>
      apiSend<Voice>(
        `/v1/incarnations/${encodeURIComponent(incarnationName)}/choirs/${encodeURIComponent(choirName)}/voices`,
        'POST',
        { body },
      ),
    // DELETE .../choirs/{choir}/voices/{sid} → 204.
    removeVoice: (incarnationName: string, choirName: string, sid: string) =>
      apiSend<void>(
        `/v1/incarnations/${encodeURIComponent(incarnationName)}/choirs/${encodeURIComponent(choirName)}/voices/${encodeURIComponent(sid)}`,
        'DELETE',
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
    // GET /v1/souls/{sid}/history — per-host operation timeline (scenario apply_runs
    // + ad-hoc errands), merge started_at DESC. type — multi-value OR (scenario|errand).
    history: (sid: string, q: ListSoulHistoryQuery = {}) =>
      apiGet<SoulHistoryReply>(`/v1/souls/${encodeURIComponent(sid)}/history`, {
        query: { type: q.type, since: q.since, offset: q.offset, limit: q.limit },
      }),
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
    // POST /v1/souls/{sid}/issue-token?force=<bool>. 200 → SoulIssueTokenReply.
    // plain bootstrap_token отдаётся один раз. 409 при активном без force=true,
    // 422 при transport: ssh.
    issueToken: (sid: string, force = false) =>
      apiSend<SoulIssueTokenReply>(
        `/v1/souls/${encodeURIComponent(sid)}/issue-token`,
        'POST',
        { query: { force } },
      ),
    // POST /v1/souls — регистрация нового хоста. 201 → SoulCreateReply.
    // bootstrap_token присутствует только для transport: agent (one-time, never log).
    // 409 → SID уже занят; 422 → невалидный SID/transport.
    create: (body: SoulCreateRequest) =>
      apiSend<SoulCreateReply>('/v1/souls', 'POST', { body }),
    // POST /v1/souls/coven. Bulk coven-assign: mode=append/remove (label) или
    // mode=replace (labels). Чанкинг с per-чанк commit — status=completed|partial.
    bulkAssignCoven: (body: SoulCovenAssignRequest) =>
      apiSend<SoulCovenAssignReply>('/v1/souls/coven', 'POST', { body }),
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

  // Push-runs глобальный list (UI-4, openapi commit 795ceba). Compact-форма entry
  // с summary_counts; per-host hosts[] — через push.get(apply_id).
  pushRuns: {
    list: (q: ListPushRunsQuery = {}) =>
      apiGet<PushRunListReply>('/v1/push-runs', {
        query: {
          status: q.status,
          ssh_provider: q.ssh_provider,
          offset: q.offset,
          limit: q.limit,
        },
      }),
  },

  // Tide-runs (ADR-040 W-4). Глобальный list + detail-snapshot.
  // Tide-API удалён (Voyage заменяет Tide, ADR-043).

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

  permissions: {
    list: () => apiGet<PermissionCatalogReply>('/v1/permissions'),
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
    // GET /v1/services/{name}/refs — git tags + branches. Endpoint опционален
    // (фиксируется backend-slice-ом параллельно); UI graceful-degraded на 404/501.
    listRefs: (name: string) =>
      apiGet<ServiceRefListReply>(`/v1/services/${encodeURIComponent(name)}/refs`),
    // GET /v1/services/{name}/scenarios[?ref=...] — каталог сценариев по git-ref.
    // Если ref не указан — service.ref. Endpoint опционален (см. listRefs).
    listScenarios: (name: string, ref?: string) =>
      apiGet<ServiceScenarioListReply>(
        `/v1/services/${encodeURIComponent(name)}/scenarios`,
        { query: { ref } },
      ),
    // GET /v1/services/{name}/state-schema[?ref=...] — state_schema-метаданные
    // (текущая state_schema_version + опц. декларация schema + список миграций).
    // Endpoint опционален для старых деплоев Keeper — UI graceful-degraded на 404/501.
    getStateSchema: (name: string, ref?: string) =>
      apiGet<ServiceStateSchemaReply>(
        `/v1/services/${encodeURIComponent(name)}/state-schema`,
        { query: { ref } },
      ),
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

  // Multi-target Errand-прогон. Slice W1 (2026-05-27).
  // SSE-stream — EventSource на `/v1/errand-runs/:id/events`; fallback на polling если backend ещё не отдаёт SSE.
  errandRuns: {
    create: (body: ErrandRunCreateRequest) =>
      apiSend<ErrandRunCreateReply>('/v1/errand-runs', 'POST', { body }),
    list: (q: ListErrandRunsQuery = {}) =>
      apiGet<ErrandRunListReply>('/v1/errand-runs', {
        query: {
          status: q.status,
          module: q.module,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (errandRunId: string) =>
      apiGet<ErrandRunView>(`/v1/errand-runs/${encodeURIComponent(errandRunId)}`),
    cancel: (errandRunId: string) =>
      apiSend<void>(`/v1/errand-runs/${encodeURIComponent(errandRunId)}`, 'DELETE'),
    // EventSource нативно отправляет JWT через ?token=… либо headers (в браузерных EventSource
    // нативно нет custom-headers). Backend SSE-роут ожидается с Bearer-cookie / query-token;
    // detail-page деградирует к polling, если EventSource fails.
    events: (errandRunId: string): EventSource =>
      new EventSource(`/v1/errand-runs/${encodeURIComponent(errandRunId)}/events`),
  },

  // Module-каталог (commit 530329d). list — для Run→Command module-search;
  // get — деталь по полному имени (params для авто-формы). Read-only.
  // Endpoint опционален для старых деплоев Keeper — UI graceful-degraded на 404/501.
  modules: {
    list: (q: ListModulesQuery = {}) =>
      apiGet<ModuleCatalogReply>('/v1/modules', {
        query: { errand_safe: q.errand_safe },
      }),
    get: (name: string) =>
      apiGet<ModuleCatalogItem>(`/v1/modules/${encodeURIComponent(name)}`),
    formPrep: (name: string, body: ModuleFormPrepRequest) =>
      apiSend<ModuleFormPrepReply>(`/v1/modules/${encodeURIComponent(name)}/form-prep`, 'POST', { body }),
  },

  // Push-providers registry (ADR-032 amendment 2026-05-26, S7-2). Используется в /run Step 2 (Push).
  pushProviders: {
    list: (q: ListPagedQuery = {}) =>
      apiGet<PushProviderListReply>('/v1/push-providers', {
        query: { offset: q.offset, limit: q.limit },
      }),
  },

  // Voyages — унифицированный батчевый прогон (ADR-043, S5). Первичный endpoint
  // для RunWizard и RunsFeed. kind=scenario → incarnation.run; kind=command → errand.run.
  voyages: {
    create: (body: VoyageCreateRequest) =>
      apiSend<VoyageCreateReply>('/v1/voyages', 'POST', { body }),
    list: (q: ListVoyagesQuery = {}) =>
      apiGet<VoyageListReply>('/v1/voyages', {
        query: {
          kind: q.kind,
          status: q.status,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (voyageId: string) =>
      apiGet<Voyage>(`/v1/voyages/${encodeURIComponent(voyageId)}`),
    cancel: (voyageId: string) =>
      apiSend<VoyageCancelReply>(`/v1/voyages/${encodeURIComponent(voyageId)}`, 'DELETE'),
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

export interface ListSoulHistoryQuery {
  // Multi-value `?type=scenario&type=errand` — OR. Пусто — оба источника.
  type?: SoulHistoryType[];
  // RFC3339; только записи с started_at > since.
  since?: string;
  offset?: number;
  limit?: number;
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

export interface ListPushRunsQuery {
  // Multi-value `?status=` — exact-match OR.
  status?: PushRunStatus[];
  ssh_provider?: string;
  offset?: number;
  limit?: number;
}

export interface ListErrandRunsQuery {
  // Multi-value `?status=` / `?module=` — exact-match OR.
  status?: ErrandRunStatus[];
  module?: string[];
  offset?: number;
  limit?: number;
}

export interface ListModulesQuery {
  // true — только модули с хотя бы одним errand-safe state (Run→Command whitelist).
  errand_safe?: boolean;
}
