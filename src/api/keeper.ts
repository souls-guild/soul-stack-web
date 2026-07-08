// Typed-обёртки над Keeper Operator API. Соответствует vendor/openapi/keeper.yaml.
//
// Типы импортируются из ./types.gen.ts (сгенерены `npm run gen:api`).
// Ручные fallback-интерфейсы (SoulprintFacts, ErrandAccepted) удалены после
// финального regen на полной huma-OpenAPI-спеке (все схемы теперь в компонентах).

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
// Run-view (GET .../runs + .../runs/{apply_id}) — apply_run НЕ Voyage: свёртка
// apply_runs по apply_id для одной инкарнации (create/rerun-last/day-2 scenario-прогон).
export type RunSummaryEntry = components['schemas']['RunSummaryEntry'];
export type IncarnationRunsReply = components['schemas']['IncarnationRunsReply'];
export type RunDetailReply = components['schemas']['RunDetailReply'];
export type RunHostStatusEntry = components['schemas']['RunHostStatusEntry'];

// GET /runs/{apply_id}/tasks (NIM-37 Схема-2). Сервер джойнит план (name/module/
// params/no_log/passage) с per-host исходами из audit (task.executed) по plan_index:
// live И история одним ответом. Схемы ядра: RunTaskEntry/RunTaskHostEntry/
// RunTaskErrorEntry/RunTasksReply; алиасы держат прежние имена для консьюмеров.
// output — register_data (структура, НЕ строка); hosts/tasks nullable по контракту.
export type RunTaskHost = components['schemas']['RunTaskHostEntry'];
export type RunTaskError = components['schemas']['RunTaskErrorEntry'];
export type RunTaskView = components['schemas']['RunTaskEntry'];
export type RunTasksReply = components['schemas']['RunTasksReply'];
export type RunStatus = NonNullable<RunSummaryEntry['status']>;
// Глобальный run-view (GET /v1/runs + /v1/runs/stats) — те же apply_run-ы, но через ВСЕ инкарнации.
export type GlobalRunEntry = components['schemas']['GlobalRunEntry'];
export type RunsListReply = components['schemas']['RunsListReply'];
export type RunsStatsBucket = components['schemas']['RunsStatsBucket'];
export type RunsStatsReply = components['schemas']['RunsStatsReply'];
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
// upgrade-paths (NIM-34): предпросмотр перехода версии — found/legacy, direction,
// reachable, применяемые state-миграции. Read-грань incarnation.upgrade.
export type IncarnationUpgradePathsReply = components['schemas']['IncarnationUpgradePathsReply'];
export type UpgradePathRef = components['schemas']['UpgradePathRef'];
export type UpgradePathTarget = components['schemas']['UpgradePathTarget'];
// StateSchemaMigration уже реэкспортирован ниже (Schema explorer) — повторно не объявляем.
export type IncarnationDestroyReply = components['schemas']['IncarnationDestroyReply'];
export type IncarnationCheckDriftRequest = components['schemas']['IncarnationCheckDriftRequest'];

export type SoulListEntry = components['schemas']['SoulListEntry'];
export type SoulListReply = components['schemas']['SoulListReply'];
export type SoulStatsReply = components['schemas']['SoulStatsReply'];
export type ClusterReply = components['schemas']['ClusterReply'];
export type ClusterInstanceEntry = components['schemas']['ClusterInstanceEntry'];
// typed_facts теперь типизирован напрямую в сгенерированной схеме SoulprintReadReply.
export type SoulprintReadReply = components['schemas']['SoulprintReadReply'];
export type SoulIssueTokenReply = components['schemas']['SoulIssueTokenReply'];
export type SoulCreateRequest = components['schemas']['SoulCreateRequest'];
export type SoulCreateReply = components['schemas']['SoulCreateReply'];
export type SoulCovenAssignRequest = components['schemas']['SoulCovenAssignRequest'];
export type SoulCovenAssignReply = components['schemas']['SoulCovenAssignReply'];
export type SoulCovenAssignSelector = components['schemas']['SoulCovenAssignSelector'];
export type SoulTraitsAssignRequest = components['schemas']['SoulTraitsAssignRequest'];
export type SoulTraitsAssignReply = components['schemas']['SoulTraitsAssignReply'];
export type SoulHistoryReply = components['schemas']['SoulHistoryReply'];
export type SoulHistoryItem = components['schemas']['SoulHistoryItem'];
export type SoulHistoryType = NonNullable<SoulHistoryItem['type']>;
// SoulprintFacts и вложенные схемы — из сгенерированных компонентов (финальная huma-спека).
export type SoulprintNetworkInterface = components['schemas']['SoulprintNetworkInterface'];
export type SoulprintNetworkFacts = components['schemas']['SoulprintNetworkFacts'];
export type SoulprintMemoryFacts = components['schemas']['SoulprintMemoryFacts'];
export type SoulprintCpuFacts = components['schemas']['SoulprintCpuFacts'];
export type SoulprintKernelFacts = components['schemas']['SoulprintKernelFacts'];
export type SoulprintOsFacts = components['schemas']['SoulprintOsFacts'];
export type SoulprintFacts = components['schemas']['SoulprintFacts'];

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
export type OperatorCreatedVia = NonNullable<Operator['created_via']>;

// Provisioning-policy — способы создания операторов (ADR-058 Часть B).
// GET/PUT /v1/provisioning-policy. Тип из схемы; enum методов — из контракта.
export type ProvisioningPolicyReply = components['schemas']['ProvisioningPolicyReply'];
export type ProvisioningPolicyUpdateRequest = components['schemas']['ProvisioningPolicyUpdateRequest'];
// ProvisioningMethod выводится из generated-схемы — при добавлении метода на бэке
// gen-тип обновится автоматически, этот alias подхватит без ручной правки.
export type ProvisioningMethod = NonNullable<ProvisioningPolicyUpdateRequest['allowed_methods']>[number];

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
// ErrandAccepted теперь из сгенерированных компонентов (финальная huma-спека).
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

// Cadence — регулярный запуск Voyage по расписанию (ADR-046). Типы из gen.
export type Cadence = components['schemas']['Cadence'];
export type CadenceCreateRequest = components['schemas']['CadenceCreateRequest'];
export type CadencePatchRequest = components['schemas']['CadencePatchRequest'];
export type CadenceCreateReply = components['schemas']['CadenceCreateReply'];
export type CadenceEnabledReply = components['schemas']['CadenceEnabledReply'];
export type CadenceListReply = components['schemas']['CadenceListReply'];
export type CadenceScheduleKind = NonNullable<Cadence['schedule_kind']>;
export type CadenceOverlapPolicy = NonNullable<Cadence['overlap_policy']>;

// Voyage — унифицированный батчевый прогон (ADR-043). Типы из gen (sources of truth).
export type VoyageStatus = NonNullable<components['schemas']['Voyage']['status']>;
export type VoyageKind = NonNullable<components['schemas']['Voyage']['kind']>;
export type VoyageOnFailure = NonNullable<components['schemas']['VoyageCreateRequest']['on_failure']>;
export type VoyageTarget = components['schemas']['VoyageTarget'];
export type VoyageCreateRequest = components['schemas']['VoyageCreateRequest'];
export type VoyageCreateReply = components['schemas']['VoyageCreateReply'];
// VoyageNotify — разовая подписка на уведомления о прогоне (ADR-052(g) amendment N2).
export type VoyageNotify = components['schemas']['VoyageNotify'];
// Допустимые терминальные события для поля `on` (completed/failed/partial).
export type VoyageNotifyOn = NonNullable<VoyageNotify['on']>[number];
export type VoyageSummary = components['schemas']['VoyageSummary'];
export type Voyage = components['schemas']['Voyage'];
export type VoyageListReply = components['schemas']['VoyageListReply'];
export type VoyageCancelReply = components['schemas']['VoyageCancelReply'];
export type VoyageTargetEntry = components['schemas']['VoyageTargetEntry'];
export type VoyageTargetStatus = VoyageTargetEntry['status'];
export type VoyageTargetsReply = components['schemas']['VoyageTargetsReply'];
export type VoyagePreviewReply = components['schemas']['VoyagePreviewReply'];

export interface ListVoyagesQuery {
  kind?: VoyageKind;
  status?: VoyageStatus[];
  offset?: number;
  limit?: number;
}

// Push-providers (ADR-032 amendment 2026-05-26, S7-2). Узкие алиасы.
export type PushProvider = components['schemas']['PushProvider'];
export type PushProviderListReply = components['schemas']['PushProviderListReply'];

// Cloud-Provider — реестр облачных провайдеров (ADR-017). Типы из gen.
export type Provider = components['schemas']['Provider'];
export type ProviderCreateRequest = components['schemas']['ProviderCreateRequest'];
export type ProviderListReply = components['schemas']['ProviderListReply'];

// Synod — группы архонов (ADR-049). Типы из gen.
export type SynodView = components['schemas']['SynodView'];
export type SynodListReply = components['schemas']['SynodListReply'];
export type SynodCreateRequest = components['schemas']['SynodCreateRequest'];
export type SynodUpdateRequest = components['schemas']['SynodUpdateRequest'];
export type SynodGrantRoleRequest = components['schemas']['SynodGrantRoleRequest'];

// Herald — канал доставки уведомлений (ADR-052, S5). Типы из gen.
export type Herald = components['schemas']['Herald'];
export type HeraldCreateRequest = components['schemas']['HeraldCreateRequest'];
export type HeraldUpdateRequest = components['schemas']['HeraldUpdateRequest'];
export type HeraldListReply = components['schemas']['HeraldListReply'];

// HeraldTypeCatalog — каталог типов Herald-канала и их config-полей (ADR-052
// amendment, ADR-042 no-hardcode). GET /v1/herald-types — единый источник
// правды для UI-формы (не хардкодить набор типов/полей).
export type HeraldTypeCatalogReply = components['schemas']['HeraldTypeCatalogReply'];
export type HeraldTypeCatalogEntry = components['schemas']['HeraldTypeCatalogEntry'];
export type HeraldTypeFieldSpec = components['schemas']['HeraldTypeFieldSpec'];

// Tiding — правило подписки на уведомления (ADR-052, S5). Типы из gen.
export type Tiding = components['schemas']['Tiding'];
export type TidingCreateRequest = components['schemas']['TidingCreateRequest'];
export type TidingUpdateRequest = components['schemas']['TidingUpdateRequest'];
export type TidingListReply = components['schemas']['TidingListReply'];

// EventTypeCatalog — каталог допустимых event-types для Tiding (ADR-042, ADR-052).
// GET /v1/event-types → areas (glob-подписки) + point_events (точечные).
export type EventTypeCatalogReply = components['schemas']['EventTypeCatalogReply'];
export type EventTypeArea = components['schemas']['EventTypeArea'];
export type EventTypePoint = components['schemas']['EventTypePoint'];

// GET /v1/me/permissions — эффективные права текущего Архонта (permission-aware UI).
export type MyPermission = components['schemas']['MyPermission'];
export type MyPermissionsReply = components['schemas']['MyPermissionsReply'];

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

// Зависимости сервиса (destiny + modules). GET /v1/services/{name}/dependencies.
export type ServiceDependency = components['schemas']['ServiceDependency'];
export type ServiceDependenciesReply = components['schemas']['ServiceDependenciesReply'];

// Rerun-last — перезапуск последнего упавшего сценария из error_locked (create или day-2).
export type IncarnationRerunLastRequest = components['schemas']['IncarnationRerunLastRequest'];
export type IncarnationRerunLastReply = components['schemas']['IncarnationRerunLastReply'];

// Hosts-editing (PATCH /v1/incarnations/{name}/hosts).
export type IncarnationSpecHost = components['schemas']['IncarnationSpecHost'];
export type IncarnationUpdateHostsRequest = components['schemas']['IncarnationUpdateHostsRequest'];
export type IncarnationUpdateHostsMode = IncarnationUpdateHostsRequest['mode'];

// Traits-editing (PUT /v1/incarnations/{name}/traits). Источник истины — incarnation.traits
// (ADR-060); проецируется в souls.traits. Полная замена (full-replace семантика).
export type IncarnationSetTraitsRequest = components['schemas']['IncarnationSetTraitsRequest'];

// NIM-74: локальный тип до регена openapi (backend добавит путь /secrets/revealable|reveal).
// Discovery: какие state-секреты можно раскрыть (по клику), и по каким ключам.
export interface RevealableSecretItem {
  secret_id: string;
  label: string;
  state_path: string;
  keys: string[];
}
export interface RevealableSecretsReply {
  items: RevealableSecretItem[] | null;
}
export interface RevealSecretRequest {
  secret_id: string;
  key: string;
}
export interface RevealSecretReply {
  value: string;
}

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
  // ключ `refs` (не `items`) — соответствие backend-схеме ServiceRefsListReply; nullable.
  refs: ServiceRefInfo[] | null;
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
  /** CEL-предикат обязательности (реактивный, как show_when). Поле обязательно, когда выражение истинно. */
  required_when?: string;
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
  /**
   * Под-поля типизированного объекта (NIM-72). Присутствует для одиночного
   * type=object (AclUser add_user.user) и для items array-of-object.
   * Примечание: object-level `required` тут — массив имён обязательных под-полей
   * (JSON-Schema-стиль), а не boolean; читается через каст.
   */
  properties?: Record<string, ScenarioInputSchemaProperty>;
  /**
   * type=object map (NIM-72): скалярная схема значения ({type:string}) → MapEditor;
   * false — типизированный объект (не map); true/absent — деградация в JSON-textarea.
   */
  additional_properties?: ScenarioInputSchemaProperty | boolean;
  /** Имя типа под-объекта (AclUser…) — лейбл в UI. */
  'x-type'?: string;
  /**
   * NIM-76: метка поля-словаря директив. Truthy-значение (напр. "redis") включает
   * inline-валидацию + typeahead ключей против каталога директив сервиса. Валидируем
   * ТОЛЬКО помеченные поля (имя redis_settings не хардкодим).
   */
  'x-directives'?: string;
  /**
   * NIM-72: field-level обязательность узла-ссылки $type. Для object-$type ключ
   * `required` занят массивом обязательных детей — «само поле обязательно» приходит
   * этой аннотацией, по ней UI ставит `*`.
   */
  'x-required'?: boolean;
  [key: string]: unknown;
}
export type ScenarioInputSchema = Record<string, ScenarioInputSchemaProperty>;

// ScenarioForm-типы: опц. презентационный слой для scenario input_schema (ADR-045).
export type ScenarioForm = components['schemas']['ScenarioForm'];
export type ScenarioFormSection = components['schemas']['ScenarioFormSection'];
export type ScenarioFormField = components['schemas']['ScenarioFormField'];

export interface ServiceScenarioInfo {
  name: string;
  // Backend отдаёт `scenario/<name>/main.yml` — read-only справочно.
  path?: string;
  /** Дискриминатор: lifecycle (create/destroy/converge) | operational. */
  kind: 'lifecycle' | 'operational';
  /**
   * Запускаем оператором из Run-формы (ADR-042, поле backend).
   * create=true, destroy=false, operational=true.
   * UI фильтрует по этому полю, а не по хардкоду имён.
   * Опционально для обратной совместимости: старый backend без поля → fallback в runnableScenarios.
   */
  runnable?: boolean;
  /**
   * Стартовый сценарий создания инкарнации (POST /v1/incarnations).
   * Если true — сценарий предлагается в dropdown при создании incarnation.
   * UI фильтрует create-сценарии по этому флагу (не по хардкоду имён).
   */
  create?: boolean;
  description?: string;
  input_schema?: ScenarioInputSchema;
  /** Опциональный презентационный слой: разбивает поля на секции с заголовками. */
  form?: ScenarioForm;
}
// Backend-shape: `{ service, ref, scenarios: [...] }` (НЕ `{ items: [...] }`).
export interface ServiceScenarioListReply {
  service?: string;
  ref?: string;
  scenarios: ServiceScenarioInfo[];
}

// GET /v1/services/{name}/directives[?ref=&version=] — каталог допустимых имён
// директив (redis.conf) по сериям Redis. directives: серия "major.minor" →
// отсортированные имена. Ответ immutable по git-ref (ETag + Cache-Control: immutable);
// кэшируем агрессивно (staleTime: Infinity, ключ service+ref). Сервис без каталога
// → directives:{} + 200. Endpoint опционален — UI graceful-degraded на 404/501.
export interface ServiceDirectivesReply {
  service?: string;
  ref?: string;
  sha1?: string;
  // Серия ("8.2") → отсортированные имена директив; nullable по контракту.
  directives: Record<string, string[]> | null;
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

// Предикат фильтра по state-полям: state.<field>=<op>:<value>.
// op ∈ eq | ne | gt | gte | lt | lte. Backend валидирует numeric op + нечисловое
// значение → 422 (нечисло в numeric-op). UI обрабатывает 422 как field-level ошибку.
export interface StateFilterPredicate {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string;
}

export interface ListIncarnationsQuery {
  service?: string;
  status?: IncarnationStatus;
  coven?: string;
  offset?: number;
  limit?: number;
  // Server-side сортировка: sort = имя колонки (name | status | created_at | state.<field>).
  // sort_dir = asc | desc.
  sort?: string;
  sort_dir?: 'asc' | 'desc';
  // Фильтры по state-полям. Сериализуются в state.<field>=<op>:<value>.
  state_filters?: StateFilterPredicate[];
}

export interface ListSoulsQuery {
  coven?: string[];
  status?: SoulStatus;
  transport?: SoulTransport;
  offset?: number;
  limit?: number;
  cursor?: string;
}

export const keeperApi = {
  // health-probe, удобно использовать как «токен валиден?» (через /v1/incarnations).
  ping: () => apiGet<IncarnationListReply>('/v1/incarnations', { query: { limit: 1 } }),

  incarnations: {
    list: (q: ListIncarnationsQuery = {}) => {
      // Сериализуем state-предикаты в повторяющиеся query-параметры:
      // state.<field>=<op>:<value>. buildUrl в client.ts поддерживает multi-value.
      const stateParams: Record<string, string[]> = {};
      for (const pred of q.state_filters ?? []) {
        const key = `state.${pred.field}`;
        const val = `${pred.op}:${pred.value}`;
        if (!stateParams[key]) stateParams[key] = [];
        stateParams[key].push(val);
      }
      return apiGet<IncarnationListReply>('/v1/incarnations', {
        query: {
          service: q.service,
          status: q.status,
          coven: q.coven,
          offset: q.offset,
          limit: q.limit,
          sort: q.sort,
          sort_dir: q.sort_dir,
          ...stateParams,
        },
      });
    },
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
    // GET /v1/incarnations/{name}/runs — список прогонов (apply_run, НЕ Voyage):
    // свёртка apply_runs по apply_id, статус applying/success/failed/cancelled.
    runs: (name: string, q: { offset?: number; limit?: number } = {}) =>
      apiGet<IncarnationRunsReply>(`/v1/incarnations/${encodeURIComponent(name)}/runs`, {
        query: { offset: q.offset, limit: q.limit },
      }),
    // GET /v1/incarnations/{name}/runs/{apply_id} — детали прогона: per-host
    // срез статусов + адрес упавшей задачи (task_idx/plan_index/error_summary).
    // НЕ полный per-task список (TaskEvent агрегируется на Soul-е, ADR-012).
    runDetail: (name: string, applyId: string) =>
      apiGet<RunDetailReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/runs/${encodeURIComponent(applyId)}`,
      ),
    // GET /v1/incarnations/{name}/runs/{apply_id}/tasks (NIM-37) — per-task ход
    // прогона (Схема-2): сервер джойнит план с per-host исходами. Live И история
    // одним ответом. 404/501 (backend-слайс не задеплоен) → graceful fallback на
    // per-host + audit.
    runTasks: (name: string, applyId: string) =>
      apiGet<RunTasksReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/runs/${encodeURIComponent(applyId)}/tasks`,
      ),
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
    // GET /v1/incarnations/{name}/upgrade-paths (NIM-34). Без `to` — теги реестра
    // + is_current; с `to` — анализ одной цели (direction/found-legacy/state-миграции).
    upgradePaths: (name: string, to?: string) =>
      apiGet<IncarnationUpgradePathsReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/upgrade-paths`,
        { query: to ? { to } : undefined },
      ),
    // DELETE /v1/incarnations/{name}?allow_destroy=<bool>. allow_destroy=true →
    // снос без teardown (force), false → штатный через scenario `destroy`.
    destroy: (name: string, allowDestroy: boolean) =>
      apiSend<IncarnationDestroyReply>(
        `/v1/incarnations/${encodeURIComponent(name)}`,
        'DELETE',
        { query: { allow_destroy: allowDestroy } },
      ),
    // POST /v1/incarnations/{name}/rerun-last — атомарный unlock + перезапуск
    // последнего упавшего сценария (create или day-2) с сохранённым input. 202 →
    // IncarnationRerunLastReply (incl. scenario). 404 нет incarnation, 403 нет
    // прав, 409 статус не error_locked ИЛИ input упавшего прогона недоступен
    // (ErrRerunInputUnavailable — вычищен ретеншном), 422 validation.
    rerunLast: (name: string, body: IncarnationRerunLastRequest) =>
      apiSend<IncarnationRerunLastReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/rerun-last`,
        'POST',
        { body },
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
    // PUT /v1/incarnations/{name}/traits — полная замена incarnation.traits (ADR-060).
    // Источник истины; проецируется в souls.traits хостов-членов.
    // Permission: incarnation.traits-set. 200 → обновлённый incarnation.
    setTraits: (name: string, body: IncarnationSetTraitsRequest) =>
      apiSend<IncarnationGetReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/traits`,
        'PUT',
        { body },
      ),
    // NIM-74: discovery раскрываемых секретов инкарнации. GET .../secrets/revealable.
    // items[] пуст, если раскрывать нечего; 404 если инкарнация вне scope — UI graceful.
    revealableSecrets: (name: string) =>
      apiGet<RevealableSecretsReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/secrets/revealable`,
      ),
    // NIM-74: раскрыть одно значение по клику (lazy, не кэшируется). POST .../secrets/reveal.
    // 200 → {value}; 403 нет права incarnation.view-secrets; 404 нет ключа/значения.
    revealSecret: (name: string, body: RevealSecretRequest) =>
      apiSend<RevealSecretReply>(
        `/v1/incarnations/${encodeURIComponent(name)}/secrets/reveal`,
        'POST',
        { body },
      ),
  },

  // Глобальный run-view через все инкарнации (apply_run, НЕ Voyage). Permission incarnation.history.
  // sort/sort_dir — серверная колоночная сортировка (whitelist
  // started_at|finished_at|status|incarnation|scenario|service; дефолт started_at desc; невалид → 422).
  runs: {
    list: (
      q: {
        status?: RunStatus;
        incarnation?: string;
        service?: string;
        q?: string;
        started_after?: string;
        started_before?: string;
        offset?: number;
        limit?: number;
        sort?: string;
        sort_dir?: 'asc' | 'desc';
      } = {},
    ) =>
      apiGet<RunsListReply>('/v1/runs', {
        query: {
          status: q.status,
          incarnation: q.incarnation,
          service: q.service,
          q: q.q,
          started_after: q.started_after,
          started_before: q.started_before,
          offset: q.offset,
          limit: q.limit,
          sort: q.sort,
          sort_dir: q.sort_dir,
        },
      }),
    stats: () => apiGet<RunsStatsReply>('/v1/runs/stats'),
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

  // HA-топология Keeper-кластера (Conclave-реестр) + self_health текущего инстанса.
  cluster: {
    get: () => apiGet<ClusterReply>('/v1/cluster'),
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
          cursor: q.cursor,
        },
      }),
    get: (sid: string) => apiGet<SoulListEntry>(`/v1/souls/${encodeURIComponent(sid)}`),
    // GET /v1/souls/stats — сводка by_status/by_transport/by_coven + total +
    // stale_count для Souls Overview. Scoped-видимость (ADR-047). Read-only.
    stats: () => apiGet<SoulStatsReply>('/v1/souls/stats'),
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
    // POST /v1/souls/traits. Bulk trait-assign: mode=merge/replace/remove.
    // dry_run — посчитать matched без UPDATE. Permission soul.traits-assign.
    assignTraits: (body: SoulTraitsAssignRequest, dryRun = false) =>
      apiSend<SoulTraitsAssignReply>('/v1/souls/traits', 'POST', {
        body,
        query: dryRun ? { dry_run: true } : undefined,
      }),
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
          payload_herald: q.payload_herald,
          payload_voyage: q.payload_voyage,
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

  // Provisioning-policy — список разрешённых методов создания операторов (ADR-058 Часть B).
  provisioning: {
    // GET /v1/provisioning-policy → ProvisioningPolicyReply.
    // policy_set=false → политика не задана (все методы разрешены по умолчанию).
    getPolicy: () => apiGet<ProvisioningPolicyReply>('/v1/provisioning-policy'),
    // PUT /v1/provisioning-policy → ProvisioningPolicyReply (replace-семантика).
    // 422 — пустой список (anti-lockout) или метод вне {user,ldap,oidc}.
    updatePolicy: (body: ProvisioningPolicyUpdateRequest) =>
      apiSend<ProvisioningPolicyReply>('/v1/provisioning-policy', 'PUT', { body }),
  },

  operators: {
    // 200 → OperatorListReply (paged + auth_method/revoked/q фильтры).
    // q — full-text по aid/display_name (backend-параметр добавляется параллельно;
    // до регена gen:api тип расширен локально в ListOperatorsQuery).
    list: (query: ListOperatorsQuery = {}) =>
      apiGet<OperatorListReply>('/v1/operators', {
        query: {
          auth_method: query.auth_method,
          revoked: query.revoked,
          q: query.q,
          offset: query.offset,
          limit: query.limit,
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
    // GET /v1/me/permissions — эффективные права текущего Архонта (permission-aware UI, ADR-042).
    listMy: () => apiGet<MyPermissionsReply>('/v1/me/permissions'),
  },

  // Synod — группы архонов, бандлирующие роли (ADR-049).
  synods: {
    // GET /v1/synods → SynodListReply (список с members + roles).
    list: () => apiGet<SynodListReply>('/v1/synods'),
    // POST /v1/synods → 201. 409 synod-already-exists.
    create: (body: SynodCreateRequest) =>
      apiSend<void>('/v1/synods', 'POST', { body }),
    // PATCH /v1/synods/{name} → 204. Меняет только description (name immutable).
    update: (name: string, body: SynodUpdateRequest) =>
      apiSend<void>(`/v1/synods/${encodeURIComponent(name)}`, 'PATCH', { body }),
    // DELETE /v1/synods/{name} → 204. 409 synod-builtin / would-lock-out-cluster.
    delete: (name: string) =>
      apiSend<void>(`/v1/synods/${encodeURIComponent(name)}`, 'DELETE'),
    operators: {
      // POST /v1/synods/{name}/operators → 201. body: {aid}.
      add: (name: string, aid: string) =>
        apiSend<void>(`/v1/synods/${encodeURIComponent(name)}/operators`, 'POST', { body: { aid } }),
      // DELETE /v1/synods/{name}/operators/{aid} → 204.
      remove: (name: string, aid: string) =>
        apiSend<void>(
          `/v1/synods/${encodeURIComponent(name)}/operators/${encodeURIComponent(aid)}`,
          'DELETE',
        ),
    },
    roles: {
      // POST /v1/synods/{name}/roles → 201. body: {role}.
      grant: (name: string, roleName: string) =>
        apiSend<void>(`/v1/synods/${encodeURIComponent(name)}/roles`, 'POST', {
          body: { role: roleName } satisfies SynodGrantRoleRequest,
        }),
      // DELETE /v1/synods/{name}/roles/{role_name} → 204.
      revoke: (name: string, roleName: string) =>
        apiSend<void>(
          `/v1/synods/${encodeURIComponent(name)}/roles/${encodeURIComponent(roleName)}`,
          'DELETE',
        ),
    },
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
    // GET /v1/services/{name}/directives[?ref=&version=] — каталог имён Redis-директив
    // по сериям (для inline-валидации/typeahead redis_settings). Кэш immutable по git-ref;
    // version — advisory (серия выбирается на клиенте). Endpoint опционален — graceful на 404/501.
    listDirectives: (name: string, opts: { ref?: string; version?: string } = {}) =>
      apiGet<ServiceDirectivesReply>(
        `/v1/services/${encodeURIComponent(name)}/directives`,
        { query: { ref: opts.ref, version: opts.version } },
      ),
    // GET /v1/services/{name}/state-schema[?ref=...] — state_schema-метаданные
    // (текущая state_schema_version + опц. декларация schema + список миграций).
    // Endpoint опционален для старых деплоев Keeper — UI graceful-degraded на 404/501.
    getStateSchema: (name: string, ref?: string) =>
      apiGet<ServiceStateSchemaReply>(
        `/v1/services/${encodeURIComponent(name)}/state-schema`,
        { query: { ref } },
      ),
    // GET /v1/services/{name}/dependencies — destiny- и module-зависимости сервиса
    // с их git-ref-ами (ADR-007). Endpoint опционален — UI graceful-degraded на 404/501.
    getDependencies: (name: string) =>
      apiGet<ServiceDependenciesReply>(`/v1/services/${encodeURIComponent(name)}/dependencies`),
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
    preview: (body: VoyageCreateRequest) =>
      apiSend<VoyagePreviewReply>('/v1/voyages/preview', 'POST', { body }),
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
    targets: (voyageId: string) =>
      apiGet<VoyageTargetsReply>(`/v1/voyages/${encodeURIComponent(voyageId)}/targets`),
  },

  // Cadence — регулярные прогоны по расписанию (ADR-046).
  cadences: {
    create: (body: CadenceCreateRequest) =>
      apiSend<CadenceCreateReply>('/v1/cadences', 'POST', { body }),
    list: (q: ListCadencesQuery = {}) =>
      apiGet<CadenceListReply>('/v1/cadences', {
        query: {
          enabled: q.enabled,
          kind: q.kind,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (id: string) =>
      apiGet<Cadence>(`/v1/cadences/${encodeURIComponent(id)}`),
    patch: (id: string, body: CadencePatchRequest) =>
      apiSend<Cadence>(`/v1/cadences/${encodeURIComponent(id)}`, 'PATCH', { body }),
    delete: (id: string) =>
      apiSend<void>(`/v1/cadences/${encodeURIComponent(id)}`, 'DELETE'),
    enable: (id: string) =>
      apiSend<CadenceEnabledReply>(`/v1/cadences/${encodeURIComponent(id)}/enable`, 'POST'),
    disable: (id: string) =>
      apiSend<CadenceEnabledReply>(`/v1/cadences/${encodeURIComponent(id)}/disable`, 'POST'),
    runs: (id: string, q: ListPagedQuery = {}) =>
      apiGet<VoyageListReply>(`/v1/cadences/${encodeURIComponent(id)}/runs`, {
        query: { offset: q.offset, limit: q.limit },
      }),
  },

  // Heralds — каналы доставки уведомлений (ADR-052, S5).
  heralds: {
    // GET /v1/heralds → HeraldListReply (sorted updated_at DESC, name ASC).
    list: (q: ListPagedQuery = {}) =>
      apiGet<HeraldListReply>('/v1/heralds', {
        query: { offset: q.offset, limit: q.limit },
      }),
    // GET /v1/heralds/{name} → Herald.
    get: (name: string) =>
      apiGet<Herald>(`/v1/heralds/${encodeURIComponent(name)}`),
    // POST /v1/heralds → 201 Herald.
    create: (body: HeraldCreateRequest) =>
      apiSend<Herald>('/v1/heralds', 'POST', { body }),
    // PUT /v1/heralds/{name} → 200 Herald (replace-семантика).
    update: (name: string, body: HeraldUpdateRequest) =>
      apiSend<Herald>(`/v1/heralds/${encodeURIComponent(name)}`, 'PUT', { body }),
    // DELETE /v1/heralds/{name} → 204. Каскадно удаляет Tiding-и.
    delete: (name: string) =>
      apiSend<void>(`/v1/heralds/${encodeURIComponent(name)}`, 'DELETE'),
  },

  // Cloud-Providers — реестр облачных провайдеров (ADR-017). Create/list/delete;
  // update не поддерживается контрактом. credentials — dual-mode (значение XOR
  // credentials_ref, ADR-064); секрет сервером не возвращается (только credentials_ref).
  providers: {
    // GET /v1/providers → ProviderListReply.
    list: (q: ListPagedQuery = {}) =>
      apiGet<ProviderListReply>('/v1/providers', {
        query: { offset: q.offset, limit: q.limit },
      }),
    // GET /v1/providers/{name} → Provider.
    get: (name: string) =>
      apiGet<Provider>(`/v1/providers/${encodeURIComponent(name)}`),
    // POST /v1/providers → 201 Provider.
    create: (body: ProviderCreateRequest) =>
      apiSend<Provider>('/v1/providers', 'POST', { body }),
    // DELETE /v1/providers/{name} → 204 (409 при зависимых Profile-ах).
    delete: (name: string) =>
      apiSend<void>(`/v1/providers/${encodeURIComponent(name)}`, 'DELETE'),
  },

  // HeraldTypeCatalog — каталог типов Herald-канала (ADR-052 amendment, ADR-042
  // no-hardcode). Список детерминирован и меняется только при обновлении
  // Keeper-а → staleTime = Infinity (паттерн permissions/eventTypes).
  heraldTypes: {
    list: () => apiGet<HeraldTypeCatalogReply>('/v1/herald-types'),
  },

  // EventTypeCatalog — каталог event-types для Tiding-формы (ADR-042, ADR-052).
  // Список детерминирован и меняется только при обновлении Keeper-а → staleTime = Infinity.
  eventTypes: {
    list: () => apiGet<EventTypeCatalogReply>('/v1/event-types'),
  },

  // Tidings — правила подписки на уведомления (ADR-052, S5).
  tidings: {
    // GET /v1/tidings → TidingListReply (sorted updated_at DESC, name ASC).
    list: (q: ListPagedQuery = {}) =>
      apiGet<TidingListReply>('/v1/tidings', {
        query: { offset: q.offset, limit: q.limit },
      }),
    // GET /v1/tidings/{name} → Tiding.
    get: (name: string) =>
      apiGet<Tiding>(`/v1/tidings/${encodeURIComponent(name)}`),
    // POST /v1/tidings → 201 Tiding.
    create: (body: TidingCreateRequest) =>
      apiSend<Tiding>('/v1/tidings', 'POST', { body }),
    // PUT /v1/tidings/{name} → 200 Tiding (replace-семантика).
    update: (name: string, body: TidingUpdateRequest) =>
      apiSend<Tiding>(`/v1/tidings/${encodeURIComponent(name)}`, 'PUT', { body }),
    // DELETE /v1/tidings/{name} → 204.
    delete: (name: string) =>
      apiSend<void>(`/v1/tidings/${encodeURIComponent(name)}`, 'DELETE'),
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
  // Имя Herald-канала из payload (payload->>'herald', exact match).
  payload_herald?: string;
  // voyage_id из payload (payload->>'voyage_id', exact match).
  // Для Voyage detail: собирает per-incarnation run-события вояжа.
  payload_voyage?: string;
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
  // Full-text по aid/display_name (typeahead). Локальное расширение до регена
  // gen:api; после реген-а совпадёт с нативным q?: string.
  q?: string;
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

export interface ListCadencesQuery {
  enabled?: boolean;
  kind?: 'scenario' | 'command';
  offset?: number;
  limit?: number;
}
