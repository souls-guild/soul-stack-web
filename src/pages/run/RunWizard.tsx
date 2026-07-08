import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { Play, ArrowLeft, ArrowRight, Send, Box, Terminal, CalendarClock } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { CONSTRAINTS } from '../../api/constraints.gen';
import type {
  CadenceScheduleKind,
  CadenceOverlapPolicy,
  ModuleCatalogItem,
  ModuleKind,
  ModuleParam,
  ScenarioInputSchema,
  ServiceScenarioInfo,
  SoulListEntry,
  VoyageOnFailure,
  VoyageNotify,
  VoyageTarget,
  VoyageCreateRequest,
  VoyagePreviewReply,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useServiceScenarios } from '../incarnations/useServiceScenarios';
import { useServiceDirectives } from '../incarnations/useServiceDirectives';
import { runnableScenarios } from '../incarnations/reservedScenarios';
import { ScenarioInputFields } from '../incarnations/ScenarioInputFields';
import {
  computeVisibleFields,
  defaultsFromSchema,
  invalidCompositeFields,
  isSupportedInputSchema,
  missingRequiredFields,
  schemaHasDirectiveField,
  serializeFields,
  type DirectiveCatalogContext,
  type ScenarioFieldsState,
} from '../incarnations/scenarioInputFields.helpers';
import {
  EMPTY_HOST_CRITERIA,
  compileSidRegex,
  hasAnyCriteria,
  matchSoulprint,
  matchStableCriteria,
  needsSoulprint,
  parseCriteriaSoulprint,
  type HostCriteria,
} from './hostSelector';
import { DynamicInputBuilder } from '../../components/input/DynamicInputBuilder';
import { ModulePicker } from './ModulePicker';
import { hasParams, paramsToInputSchema } from './moduleParams.helpers';
import { ChipsInput } from '../incarnations/ChipsInput';
import { NotifyBlock } from './NotifyBlock';
import { serializeNotify } from './notifyHelpers';
import pageStyles from '../common.module.css';
import styles from './WizardSteps.module.css';

// Workload-тип Step 1. Push убран — он стал внутренним транспортом unified-Run,
// больше не пользовательский тип (route /push остаётся deprecated).
type Workload = 'scenario' | 'command';

// Режим запуска: one-time Voyage или recurring Cadence.
type RunMode = 'voyage' | 'cadence';

// Stepper-определение. Семантика Step 2/3 различается по workload:
//   Scenario: Step2=выбор scenario, Step3=incarnations, Step4=input+options.
//   Command:  Step2=выбор хостов, Step3=module+params, Step4=options.
const STEPS: Array<{ id: 1 | 2 | 3 | 4; label: string }> = [
  { id: 1, label: 'Workload' },
  { id: 2, label: 'Select' },
  { id: 3, label: 'Configure' },
  { id: 4, label: 'Options' },
];

// Step 1 — выбор workload. `title` — имя workload-сущности (English, не переводится);
// `descKey` — i18n-ключ описания (переводится).
const WORKLOADS: Array<{ kind: Workload; title: string; descKey: string; icon: typeof Box }> = [
  { kind: 'scenario', title: 'Scenario apply', descKey: 'run:workloadScenarioDesc', icon: Box },
  { kind: 'command', title: 'Command', descKey: 'run:workloadCommandDesc', icon: Terminal },
];

interface ScenarioStateValues {
  service: string;
  scenario: string;
  // Regex по имени incarnation — источник истины множества для fan-out. Список
  // совпавших показывается read-only; сценарий запускается на ВСЕХ совпавших.
  incarnationRegex: string;
  // Производное от incarnationRegex множество имён (резолвится в Step3 при наличии
  // загруженного списка incarnations). Хранится в state, чтобы submit и валидация
  // не зависели от смонтированности шага.
  incarnations: string[];
  fields: ScenarioFieldsState;
  // Используется только когда scenario без typed input_schema — DynamicInputBuilder.
  inputObj: Record<string, unknown>;
}

// Command-модуль выбирается из каталога (GET /v1/modules) через ModulePicker.
// `moduleName` — имя без state-суффикса (`core.cmd`); `moduleState` — выбранный
// state (`shell`); полный адрес для submit — `<moduleName>.<moduleState>`.
//
// Ветвление формы параметров:
//   - модуль с params[] → типизированная per-field форма (ScenarioInputFields).
//   - каталог недоступен (404/501) → free-text имя + DynamicInputBuilder.
interface CommandStateValues {
  // Имя выбранного модуля (без state-суффикса), напр. `core.cmd`. Пусто — не выбран.
  moduleName: string;
  // Выбранный state модуля (`shell`/`run`/...). Полный адрес — `moduleName.moduleState`.
  moduleState: string;
  // Допустимые state-суффиксы выбранного модуля (для dropdown при >1).
  moduleStates: string[];
  // core | plugin (из каталога). '' пока ничего не выбрано.
  moduleKind: ModuleKind | '';
  // Параметры модуля из каталога (для авто-формы; пусты у core).
  moduleParams: ModuleParam[];
  // Типизированные значения params-формы (для модулей с params[]).
  paramFields: ScenarioFieldsState;
  timeoutSeconds: number;
  // Free-text fallback (каталог недоступен): имя модуля + динамический input.
  customModule: string;
  customInput: Record<string, unknown>;
}

// Тип enum batch_mode берётся из types.gen через VoyageCreateRequest — не хардкодим строки.
type VoyageBatchMode = NonNullable<import('../../api/types.gen').components['schemas']['VoyageCreateRequest']['batch_mode']>;

interface OptionsState {
  // Новое унифицированное строковое поле batch (N | N%). Keeper парсит, UI не парсит.
  batch: string;
  // Порог провалов: N | N%. Keeper парсит. Пусто = поведение по on_failure.
  maxFailures: string;
  concurrency: string;
  // VoyageOnFailure = 'abort' | 'continue' (супerset ErrandRunOnFailure).
  onFailure: VoyageOnFailure;
  dryRun: boolean;
  wait: boolean;
  // Отложенный старт (ISO-8601). Пусто → немедленный старт.
  scheduleAt: string;
  // Режим батчинга (ADR-043). barrier = последовательные Leg-и (дефолт); window = скользящее окно.
  batchMode: VoyageBatchMode;
  // Пауза между Leg-ами в ms (barrier). Пусто = без паузы.
  interBatchIntervalMs: string;
  // Пауза между единицами окна в ms (window). Пусто = без паузы.
  interUnitIntervalMs: string;
  // Presence-фильтр: только живые хосты. Применяется к kind=command.
  requireAlive: boolean;
}

const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Лёгкая UX-валидация формата batch: N или N% (авторитет — backend 422).
const BATCH_FORMAT_RE = /^\d+%?$/;

// Cadence-специфичный state (используется только при runMode='cadence').
interface CadenceState {
  cadenceName: string;
  scheduleKind: CadenceScheduleKind;
  intervalSeconds: string;
  cronExpr: string;
  overlapPolicy: CadenceOverlapPolicy;
}

// Черновик wizard-а в sessionStorage: переживает навигацию away/back между шагами
// и сменой workload (под-шаги пере-монтируются — без persist локальный state шага
// терялся бы). Очищается после успешного submit.
const DRAFT_KEY = 'run-wizard-draft';

// Версия схемы черновика. Поднимать при любом изменении формы под-state-ов
// (новое поле, смена типа). loadDraft() отбрасывает черновики с другой/отсутствующей
// версией — старый persisted-state предыдущей формы визарда игнорируется, визард
// стартует с дефолтов, а не падает на отсутствующем поле.
const DRAFT_VERSION = 10;

interface WizardDraft {
  v: number;
  step: 1 | 2 | 3 | 4;
  workload: Workload;
  runMode: RunMode;
  scenarioState: ScenarioStateValues;
  commandState: CommandStateValues;
  hostCriteria: HostCriteria;
  options: OptionsState;
  cadenceState: CadenceState;
  notify: VoyageNotify[];
}

// Дефолты под-state-ов. Используются как база default-merge при восстановлении
// черновика и как initial-state при отсутствии query-intent/черновика. Любое
// поле, отсутствующее в загруженном черновике, берётся отсюда (вторая линия
// защиты от рассинхрона формы, независимая от версионирования).
const DEFAULT_SCENARIO_STATE: ScenarioStateValues = {
  service: '',
  scenario: '',
  incarnationRegex: '',
  incarnations: [],
  fields: {},
  inputObj: {},
};

const DEFAULT_COMMAND_STATE: CommandStateValues = {
  moduleName: 'core.cmd',
  moduleState: 'shell',
  moduleStates: ['shell'],
  moduleKind: 'core',
  moduleParams: [],
  paramFields: {},
  timeoutSeconds: 30,
  customModule: '',
  customInput: {},
};

const DEFAULT_OPTIONS: OptionsState = {
  batch: '',
  maxFailures: '',
  concurrency: '50',
  onFailure: 'abort',
  dryRun: false,
  wait: false,
  scheduleAt: '',
  batchMode: 'barrier',
  interBatchIntervalMs: '',
  interUnitIntervalMs: '',
  requireAlive: false,
};

const DEFAULT_CADENCE_STATE: CadenceState = {
  cadenceName: '',
  scheduleKind: 'interval',
  intervalSeconds: '3600',
  cronExpr: '',
  overlapPolicy: 'skip',
};

function loadDraft(): WizardDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraft> | null;
    // Версия не совпадает (или отсутствует у черновика старой формы) → игнорируем.
    if (!parsed || parsed.v !== DRAFT_VERSION) return null;
    return parsed as WizardDraft;
  } catch {
    return null;
  }
}

// Гарантирует массив: если в черновике пришёл не-массив/undefined — дефолтный [].
function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function pickWorkloadFromQuery(raw: string | null): Workload {
  if (raw === 'command') return 'command';
  return 'scenario';
}

// Разбор query-param `module` (deep-link / bulk-run) на (name, state).
// Полный адрес `core.cmd.shell` → name=`core.cmd`, state=`shell`. Дефолт —
// core.cmd.shell. Plugin-модули в формате `official.postgres-user.present` тоже
// корректно разбиваются (последний сегмент — state).
function pickInitialCommandModule(raw: string | null): { name: string; state: string } {
  if (!raw) return { name: 'core.cmd', state: 'shell' };
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return { name: raw, state: '' };
  return { name: raw.slice(0, idx), state: raw.slice(idx + 1) };
}

export function RunWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Любой явный query-param = намерение deep-link → черновик игнорируется (свежий
  // вход через bulk-run/ссылку начинает заново). Без query-params восстанавливаем
  // сохранённый черновик (навигация away/back между шагами).
  const hasQueryIntent = useMemo(
    () =>
      ['workload', 'service', 'scenario', 'incarnation', 'incarnation_regex', 'module', 'target_coven', 'target_regex', 'target_sids'].some(
        (k) => searchParams.has(k),
      ),
    [searchParams],
  );
  const draft = useMemo<WizardDraft | null>(
    () => (hasQueryIntent ? null : loadDraft()),
    // читаем один раз на mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const initialWorkload = pickWorkloadFromQuery(searchParams.get('workload'));
  const initialService = searchParams.get('service') ?? '';
  const initialScenario = searchParams.get('scenario') ?? '';
  const initialIncarnation = searchParams.get('incarnation') ?? '';
  // incarnation_regex — сырой regex от snapshot-Run (IncarnationsList.handleRunSet).
  // Передаётся как есть в incarnationRegex без повторного экранирования/обёртки.
  const initialIncarnationRegex = searchParams.get('incarnation_regex') ?? '';
  const initialModuleParam = searchParams.get('module');

  // Pre-fill host-criteria из query (bulk-run actions со списочных страниц):
  //   target_sids → нет прямого mapping в criteria; кладём как sidRegex-anchor-OR
  //   target_coven → covens; target_regex → sidRegex; target_where не маппится
  //   на DSL (raw CEL), игнорируется в criteria-режиме.
  const initialCriteria = useMemo<HostCriteria>(
    () => criteriaFromQuery(searchParams),
    // searchParams читаем один раз на mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const hasCriteriaFromQuery = useMemo(
    () => hasAnyCriteria(initialCriteria),
    [initialCriteria],
  );

  const [step, setStep] = useState<1 | 2 | 3 | 4>(draft?.step ?? 1);
  const [workload, setWorkload] = useState<Workload>(draft?.workload ?? initialWorkload);
  const [runMode, setRunMode] = useState<RunMode>(() => {
    if (draft) return draft.runMode ?? 'voyage';
    // deep-link ?recurrence=true → сразу открывает cadence-режим
    return searchParams.get('recurrence') === 'true' ? 'cadence' : 'voyage';
  });

  // Инициализация под-state-ов: при наличии черновика — default-merge на уровне
  // под-объекта (новое поле всегда имеет значение из дефолта, если в черновике
  // его нет), массивные поля дополнительно страхуются по типу через asArray.
  // Без черновика — initial из query (или дефолты).
  const [scenarioState, setScenarioState] = useState<ScenarioStateValues>(() => {
    if (draft) {
      const d = draft.scenarioState ?? {};
      return {
        ...DEFAULT_SCENARIO_STATE,
        ...d,
        incarnations: asArray(d.incarnations, DEFAULT_SCENARIO_STATE.incarnations),
      };
    }
    // Приоритет: incarnation_regex (snapshot-OR, уже готовый regex) > incarnation (одиночная инкарнация).
    const regexFromSnapshot = initialIncarnationRegex;
    const regexFromSingle = initialIncarnation ? `^${escapeRegex(initialIncarnation)}$` : '';
    const incarnationRegex = regexFromSnapshot || regexFromSingle;
    // incarnations-пре-фил только для одиночного deep-link (snapshot-list резолвится в Step3).
    const incarnations = initialIncarnation && !initialIncarnationRegex ? [initialIncarnation] : [];
    return {
      ...DEFAULT_SCENARIO_STATE,
      service: initialService,
      scenario: initialScenario,
      incarnationRegex,
      incarnations,
    };
  });

  const [commandState, setCommandState] = useState<CommandStateValues>(() => {
    if (draft) {
      const d = draft.commandState ?? {};
      return {
        ...DEFAULT_COMMAND_STATE,
        ...d,
        moduleStates: asArray(d.moduleStates, DEFAULT_COMMAND_STATE.moduleStates),
        moduleParams: asArray(d.moduleParams, DEFAULT_COMMAND_STATE.moduleParams),
      };
    }
    const m = pickInitialCommandModule(initialModuleParam);
    // Если задан ?module= с params → предзаполним paramFields при загрузке каталога.
    return {
      ...DEFAULT_COMMAND_STATE,
      moduleName: m.name,
      moduleState: m.state,
      moduleStates: m.state ? [m.state] : [],
      moduleKind: m.name.startsWith('core.') ? 'core' : initialModuleParam ? '' : 'core',
    };
  });

  const [hostCriteria, setHostCriteria] = useState<HostCriteria>(() => {
    if (draft) {
      const d = draft.hostCriteria ?? {};
      return {
        ...EMPTY_HOST_CRITERIA,
        ...d,
        incarnations: asArray(d.incarnations, EMPTY_HOST_CRITERIA.incarnations),
        covens: asArray(d.covens, EMPTY_HOST_CRITERIA.covens),
      };
    }
    return hasCriteriaFromQuery ? initialCriteria : EMPTY_HOST_CRITERIA;
  });

  const [options, setOptions] = useState<OptionsState>(() =>
    draft ? { ...DEFAULT_OPTIONS, ...(draft.options ?? {}) } : DEFAULT_OPTIONS,
  );

  const [cadenceState, setCadenceState] = useState<CadenceState>(() =>
    draft ? { ...DEFAULT_CADENCE_STATE, ...(draft.cadenceState ?? {}) } : DEFAULT_CADENCE_STATE,
  );

  const [notify, setNotify] = useState<VoyageNotify[]>(() =>
    draft ? asArray<VoyageNotify>(draft.notify, []) : [],
  );

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ошибки map-полей и pattern-полей (поднимаются из ScenarioInputFields).
  // Включаются в submit-gate наряду с invalidCompositeFields/missingRequired.
  const [scenarioInvalidMaps, setScenarioInvalidMaps] = useState<string[]>([]);
  const [scenarioPatternErrors, setScenarioPatternErrors] = useState<string[]>([]);
  const [commandInvalidMaps, setCommandInvalidMaps] = useState<string[]>([]);
  const [commandPatternErrors, setCommandPatternErrors] = useState<string[]>([]);

  // Persist черновика на каждое изменение wizard-state. sessionStorage —
  // переживает навигацию внутри вкладки браузера, чистится при закрытии вкладки.
  useEffect(() => {
    const payload: WizardDraft = { v: DRAFT_VERSION, step, workload, runMode, scenarioState, commandState, hostCriteria, options, cadenceState, notify };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage недоступен (private-mode/quota) — persist опционален, не падаем.
    }
  }, [step, workload, runMode, scenarioState, commandState, hostCriteria, options, cadenceState, notify]);

  function goNext() {
    setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s));
  }
  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s));
  }

  const scenariosQ = useServiceScenarios(workload === 'scenario' ? scenarioState.service || undefined : undefined);
  const selectedScenarioMeta = useMemo<ServiceScenarioInfo | undefined>(
    () => scenariosQ.items.find((s) => s.name === scenarioState.scenario),
    [scenariosQ.items, scenarioState.scenario],
  );
  const inputSchema: ScenarioInputSchema | undefined = selectedScenarioMeta?.input_schema;
  const usePerField = isSupportedInputSchema(inputSchema);

  // NIM-76: day-2 update_config — версия Redis не задаётся в форме, берём её из
  // state.redis_version инкарнации (первая из resolved-множества). Гейтим на наличие
  // поля с x-directives в схеме (не тянем incarnation/каталог для не-redis сценариев).
  const hasDirectiveField = useMemo(() => schemaHasDirectiveField(inputSchema), [inputSchema]);
  // Directive-валидация (hard-block, 3A) применима ТОЛЬКО к одиночному таргету: при
  // fan-out на >1 инкарнацию их redis_version могут различаться → одна версия жёстко
  // блокировала бы валидные на других. >1 → graceful (не валидируем; backend 422 финален).
  const dayTwoSingle = workload === 'scenario' && scenarioState.incarnations.length === 1;
  const dayTwoIncarnation = dayTwoSingle ? scenarioState.incarnations[0] : '';
  const incarnationDetailQ = useQuery({
    queryKey: ['incarnation', dayTwoIncarnation],
    queryFn: () => keeperApi.incarnations.get(dayTwoIncarnation),
    enabled: Boolean(dayTwoIncarnation) && hasDirectiveField,
  });
  const directiveVersion = useMemo(() => {
    const st = incarnationDetailQ.data?.state as Record<string, unknown> | undefined;
    const v = st?.['redis_version'];
    return typeof v === 'string' && v !== '' ? v : v != null ? String(v) : undefined;
  }, [incarnationDetailQ.data]);
  const directivesQ = useServiceDirectives(hasDirectiveField ? scenarioState.service || undefined : undefined);
  const directiveCatalog = useMemo<DirectiveCatalogContext>(
    () => ({ directives: directivesQ.directives, loaded: !directivesQ.loading && !directivesQ.unavailable }),
    [directivesQ.directives, directivesQ.loading, directivesQ.unavailable],
  );

  // --- Резолв хостов для Command (live preview + submit). ---
  // Всегда грузим soul-список (для preview); фильтрация — client-side.
  const soulsListQ = useQuery({
    queryKey: ['run.command.souls.list'],
    queryFn: () => keeperApi.souls.list({ limit: 1000 }),
    enabled: workload === 'command',
  });
  const allSouls = useMemo<SoulListEntry[]>(() => soulsListQ.data?.items ?? [], [soulsListQ.data]);

  const parsedSoulprint = useMemo(() => parseCriteriaSoulprint(hostCriteria), [hostCriteria]);
  const sidRegexComp = useMemo(() => compileSidRegex(hostCriteria.sidRegex), [hostCriteria.sidRegex]);

  // Stage 1: стабильные критерии (incarnation/coven/sid-regex) — без soulprint-fetch.
  const stableMatched = useMemo<SoulListEntry[]>(() => {
    if (workload !== 'command' || !hasAnyCriteria(hostCriteria)) return [];
    return allSouls.filter((s) => matchStableCriteria(s, hostCriteria, sidRegexComp.re));
  }, [workload, hostCriteria, allSouls, sidRegexComp.re]);

  // Stage 2: soulprint-fetch только для уже отфильтрованных stable-кандидатов и
  // только если soulprint-критерий задан.
  const soulprintActive = needsSoulprint(hostCriteria);
  const soulprintQueries = useQueries({
    queries: stableMatched.map((row) => ({
      queryKey: ['soulprint', row.sid] as const,
      queryFn: async () => {
        try {
          return await keeperApi.souls.getSoulprint(row.sid);
        } catch {
          return null;
        }
      },
      enabled: workload === 'command' && soulprintActive,
      staleTime: 60_000,
    })),
  });

  const soulprintLoading = soulprintActive && soulprintQueries.some((res) => res.isLoading);

  // Stage 3: финальный список SID после soulprint-правил.
  const resolvedSouls = useMemo<SoulListEntry[]>(() => {
    if (!soulprintActive) return stableMatched;
    const out: SoulListEntry[] = [];
    for (let i = 0; i < stableMatched.length; i++) {
      const sp = soulprintQueries[i]?.data;
      if (matchSoulprint(sp?.typed_facts, parsedSoulprint.rules)) out.push(stableMatched[i]);
    }
    return out;
    // soulprintQueries — массив result-объектов, ссылочно стабилен в рамках рендера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soulprintActive, stableMatched, parsedSoulprint.rules, soulprintQueries.map((q) => q.data)]);

  const resolvedSids = useMemo(() => resolvedSouls.map((s) => s.sid), [resolvedSouls]);

  // --- Резолв incarnations для Scenario (preview + multi-select). ---
  const incarnationsListQ = useQuery({
    queryKey: ['run.scenario.incarnations.list', scenarioState.service],
    queryFn: () => keeperApi.incarnations.list({ service: scenarioState.service, limit: 500 }),
    enabled: workload === 'scenario' && Boolean(scenarioState.service),
  });

  // Souls по covens=incarnation-имени → host-count каждой incarnation.
  const incarnationNames = useMemo(
    () => (incarnationsListQ.data?.items ?? []).map((i) => i.name),
    [incarnationsListQ.data],
  );
  const incarnationSoulsQ = useQuery({
    queryKey: ['run.scenario.incarnation.souls', incarnationNames],
    queryFn: () => keeperApi.souls.list({ coven: incarnationNames, limit: 1000 }),
    enabled: workload === 'scenario' && incarnationNames.length > 0,
  });
  // Map incarnation-name → host-count (по coven-membership). undefined если souls
  // ещё грузятся или endpoint недоступен — тогда показываем имя без count.
  const hostCountByIncarnation = useMemo<Record<string, number> | undefined>(() => {
    const souls = incarnationSoulsQ.data?.items;
    if (!souls) return undefined;
    const counts: Record<string, number> = {};
    for (const name of incarnationNames) counts[name] = 0;
    for (const s of souls) {
      for (const cv of s.covens ?? []) {
        if (cv in counts) counts[cv] += 1;
      }
    }
    return counts;
  }, [incarnationSoulsQ.data, incarnationNames]);

  // --- Step-валидация. ---
  const canAdvanceFromStep2 = useMemo(() => {
    if (workload === 'scenario') {
      return Boolean(scenarioState.service && scenarioState.scenario);
    }
    // command: Step2 — выбор хостов; нужен хоть один критерий И непустой резолв.
    return hasAnyCriteria(hostCriteria) && resolvedSids.length > 0;
  }, [workload, scenarioState, hostCriteria, resolvedSids]);

  // Пустые required-поля typed input_schema сценария (зеркалит backend 422).
  // Учитываем show_when: скрытые поля не входят в gate.
  const scenarioMissingRequired = useMemo(
    () => {
      if (workload !== 'scenario' || !usePerField) return [];
      const visibleFields = computeVisibleFields(selectedScenarioMeta?.form, scenarioState.fields);
      return missingRequiredFields(inputSchema, scenarioState.fields, visibleFields);
    },
    [workload, usePerField, inputSchema, scenarioState.fields, selectedScenarioMeta?.form],
  );

  // Составные поля (array/object) с непарсимым JSON — блокируют submit/«Далее».
  const scenarioInvalidComposite = useMemo(
    () => (workload === 'scenario' && usePerField ? invalidCompositeFields(inputSchema, scenarioState.fields) : []),
    [workload, usePerField, inputSchema, scenarioState.fields],
  );

  // Пустые required params типизированной формы (модули с params[]).
  const commandMissingRequired = useMemo(() => {
    if (workload !== 'command' || !hasParams(commandState.moduleParams)) return [];
    return missingRequiredFields(paramsToInputSchema(commandState.moduleParams), commandState.paramFields);
  }, [workload, commandState.moduleParams, commandState.paramFields]);

  const canAdvanceFromStep3 = useMemo(() => {
    if (workload === 'scenario') {
      return (
        scenarioState.incarnations.length > 0 &&
        scenarioMissingRequired.length === 0 &&
        scenarioInvalidComposite.length === 0 &&
        scenarioInvalidMaps.length === 0 &&
        scenarioPatternErrors.length === 0
      );
    }
    // command: Step3 — module+params.
    // Free-text fallback (каталог недоступен): нужно имя модуля.
    if (!commandState.moduleName.trim()) return false;
    // Модуль с params — все required заполнены, нет map-ошибок и pattern-ошибок.
    if (hasParams(commandState.moduleParams)) {
      return (
        commandMissingRequired.length === 0 &&
        commandInvalidMaps.length === 0 &&
        commandPatternErrors.length === 0
      );
    }
    // Модуль без формализованных params (free-text fallback) — имени достаточно.
    return true;
  }, [
    workload,
    scenarioState.incarnations,
    scenarioMissingRequired,
    scenarioInvalidComposite,
    scenarioInvalidMaps,
    scenarioPatternErrors,
    commandState,
    commandMissingRequired,
    commandInvalidMaps,
    commandPatternErrors,
  ]);

  // --- Submit ---
  const submitMu = useMutation({
    mutationFn: async () => {
      if (runMode === 'cadence') return submitCadence();
      if (workload === 'scenario') return submitScenario();
      return submitCommand();
    },
    onError: (err) => {
      setSubmitError(
        err instanceof ApiError
          ? t('run:submitErrorPrefix', { status: err.status, message: err.message })
          : String(err),
      );
    },
    onSuccess: (redirect) => {
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      navigate(redirect);
    },
  });

  /** Конвертирует datetime-local строку в ISO-8601 с зоной для OpenAPI date-time.
   * Пустая строка → undefined. Invalid Date → undefined (guard, до submit не доходит). */
  function scheduleAtIso(raw: string): string | undefined {
    const s = raw.trim();
    if (!s) return undefined;
    const d = new Date(s);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  // Строит общую часть опций для обоих workload.
  function buildOptionsPayload() {
    const c = parseIntOrEmpty(options.concurrency);
    const concurrency = c && c > 0 ? c : 50;
    const batchMode = options.batchMode;

    // Новые строковые поля batch / max_failures — шлём сырую строку, Keeper парсит.
    // Пустая строка = не задано → не шлём поле (undefined → omit).
    const batch = options.batch.trim() || undefined;
    const maxFailures = options.maxFailures.trim() || undefined;

    const interBatchMs =
      batchMode === 'barrier' ? parseIntOrEmpty(options.interBatchIntervalMs) : undefined;
    const interUnitMs =
      batchMode === 'window' ? parseIntOrEmpty(options.interUnitIntervalMs) : undefined;

    return {
      concurrency,
      batch_mode: batchMode,
      batch,
      max_failures: maxFailures,
      inter_batch_interval_ms: interBatchMs && interBatchMs > 0 ? interBatchMs : undefined,
      inter_unit_interval_ms: interUnitMs && interUnitMs > 0 ? interUnitMs : undefined,
      on_failure: options.onFailure,
      schedule_at: scheduleAtIso(options.scheduleAt),
    };
  }

  interface RecipePayload {
    kind: 'scenario' | 'command';
    scenario_name?: string;
    module?: string;
    input?: Record<string, unknown>;
    target: VoyageTarget;
  }

  /**
   * Строит recipe-часть (kind + workload-поля + target).
   *
   * forCadence=true (command): шлёт declared-критерии (coven/where) вместо
   * snapshot sids, чтобы backend резолвил target на каждом тике (late-binding).
   *
   * Исключение — если coven не задан и оператор использовал только
   * regex/soulprint: fallback на snapshot sids (declared-target был бы пустым).
   * UI предупреждает об этом плашкой cadenceSnapshotOnlyWarn.
   */
  function buildRecipePayload(forCadence = false): RecipePayload {
    if (workload === 'scenario') {
      const inputObj =
        usePerField && inputSchema
          ? serializeFields(inputSchema, scenarioState.fields)
          : scenarioState.inputObj;
      return {
        kind: 'scenario',
        scenario_name: scenarioState.scenario,
        input: Object.keys(inputObj).length > 0 ? inputObj : undefined,
        target: { incarnations: scenarioState.incarnations },
      };
    } else {
      // Полный адрес модуля — `<name>.<state>` (state опускается, если пуст —
      // free-text fallback мог не задать его).
      const moduleName = commandState.moduleState
        ? `${commandState.moduleName}.${commandState.moduleState}`
        : commandState.moduleName;
      let input: Record<string, unknown>;
      if (hasParams(commandState.moduleParams)) {
        input = serializeFields(paramsToInputSchema(commandState.moduleParams), commandState.paramFields);
      } else {
        input = commandState.customInput;
      }

      // Cadence (forCadence=true): отправляем declared coven-критерии для late-binding.
      // Backend Voyage-resolver поддерживает `target.coven[]` для kind=command и
      // резолвит их в snapshot хостов на каждом тике — новые coven-члены подхватятся.
      //
      // Исключение: если coven не задан (оператор задал только sidRegex/soulprint),
      // declared-target будет пустым → fallback на snapshot sids (UI предупреждает).
      if (forCadence && hostCriteria.covens.length > 0) {
        const declaredTarget: VoyageTarget = { coven: hostCriteria.covens };
        // where не evaluate-ится в MVP (backend сохраняет, не применяет), но
        // передаём для будущей совместимости, если оператор задал его через UI.
        return {
          kind: 'command',
          module: moduleName,
          input: Object.keys(input).length > 0 ? input : undefined,
          target: declaredTarget,
        };
      }

      // Разовый Voyage или Cadence без coven: snapshot sids (корректно по ADR-043 §5/§8).
      return {
        kind: 'command',
        module: moduleName,
        input: Object.keys(input).length > 0 ? input : undefined,
        target: { sids: resolvedSids },
      };
    }
  }

  async function submitScenario(): Promise<string> {
    const recipe = buildRecipePayload();
    const opts = buildOptionsPayload();
    const notifyPayload = serializeNotify(notify);
    const reply = await keeperApi.voyages.create({
      ...recipe,
      dry_run: Boolean(options.dryRun),
      require_alive: options.requireAlive,
      ...opts,
      ...(notifyPayload ? { notify: notifyPayload } : {}),
    });
    return `/voyages/${encodeURIComponent(reply.voyage_id)}`;
  }

  async function submitCommand(): Promise<string> {
    const recipe = buildRecipePayload();
    const opts = buildOptionsPayload();
    const notifyPayload = serializeNotify(notify);
    const reply = await keeperApi.voyages.create({
      ...recipe,
      dry_run: false,
      require_alive: options.requireAlive,
      ...opts,
      ...(notifyPayload ? { notify: notifyPayload } : {}),
    });
    return `/voyages/${encodeURIComponent(reply.voyage_id)}`;
  }

  async function submitCadence(): Promise<string> {
    const recipe = buildRecipePayload(/* forCadence */ true);
    const opts = buildOptionsPayload();
    const intervalSec = parseIntOrEmpty(cadenceState.intervalSeconds);
    const notifyPayload = serializeNotify(notify);
    const reply = await keeperApi.cadences.create({
      name: cadenceState.cadenceName,
      enabled: true,
      schedule_kind: cadenceState.scheduleKind,
      interval_seconds: cadenceState.scheduleKind === 'interval' ? intervalSec : undefined,
      cron_expr: cadenceState.scheduleKind === 'cron' ? cadenceState.cronExpr : undefined,
      overlap_policy: cadenceState.overlapPolicy,
      ...recipe,
      ...opts,
      require_alive: options.requireAlive,
      ...(notifyPayload ? { notify: notifyPayload } : {}),
    });
    return `/cadences/${encodeURIComponent(reply.cadence_id)}`;
  }

  // batch — лёгкая UX-валидация: пусто = ok; если заполнено — должно соответствовать
  // грамматике keeper (^(\d+)%?$). Авторитетная проверка — на backend (422).
  // window + непустой batch → backend вернёт 422 (молча блокируем только явно-мусорный формат).
  const batchValid = useMemo(() => {
    const s = options.batch.trim();
    if (!s) return true; // пусто — ok
    return BATCH_FORMAT_RE.test(s);
  }, [options.batch]);

  // scheduleAt — опциональное поле; если задано, должно быть в будущем.
  const scheduleAtValid = useMemo(() => {
    const s = options.scheduleAt.trim();
    if (!s) return true; // пусто — немедленный запуск, валидно
    return new Date(s) > new Date();
  }, [options.scheduleAt]);

  // Cadence-специфичная валидация Step 4.
  const cadenceValid = useMemo(() => {
    if (runMode !== 'cadence') return true;
    if (!cadenceState.cadenceName.trim()) return false;
    if (cadenceState.scheduleKind === 'interval') {
      const s = parseIntOrEmpty(cadenceState.intervalSeconds);
      return Boolean(s && s >= CONSTRAINTS.cadenceIntervalSecondsMin);
    }
    // cron: непустая строка (формат проверяет backend)
    return cadenceState.cronExpr.trim().length > 0;
  }, [runMode, cadenceState]);

  const canSubmit = canAdvanceFromStep2 && canAdvanceFromStep3 && batchValid && (runMode === 'cadence' ? cadenceValid : scheduleAtValid) && !submitMu.isPending;

  // --- Preview-логика батчей ---
  // Snapshot-target: явные SID / regex / инкарнации — scope известен клиенту.
  // Late-binding target: coven — scope резолвит Keeper; нужен /preview.
  //
  // Для Command: coven[] непустой → late-binding.
  // Для Scenario: incarnations[] — snapshot (список известен после regex-резолва).
  const isLateBinding = workload === 'command' && hostCriteria.covens.length > 0 && hostCriteria.sidRegex.trim().length === 0 && hostCriteria.soulprint.trim().length === 0;

  // Scope для snapshot-count: для scenario = число инкарнаций; для command = число resolved SIDs.
  const snapshotScope = workload === 'scenario' ? scenarioState.incarnations.length : resolvedSids.length;

  // Локальный расчёт числа батчей для snapshot-target.
  // batch = '' | 'N' | 'N%'. При window — всегда 1 (batch не используется в window-семантике).
  const localBatchCount = useMemo(() => {
    if (options.batchMode === 'window') return 1;
    const s = options.batch.trim();
    if (!s || snapshotScope === 0) return null;
    if (s.endsWith('%')) {
      const pct = parseInt(s, 10);
      if (!pct || pct < 1 || pct > 100) return null;
      const effective = Math.ceil(snapshotScope * pct / 100);
      if (effective === 0) return null;
      return Math.ceil(snapshotScope / effective);
    }
    const n = parseInt(s, 10);
    if (!n || n < 1) return null;
    return Math.ceil(snapshotScope / n);
  }, [options.batch, options.batchMode, snapshotScope]);

  // Preview-запрос для late-binding target (debounce на смену TARGET — не на ввод batch).
  // Строим тело preview как buildRecipePayload() + buildOptionsPayload(), но без draft.
  // Мы не можем вызывать build* внутри useMemo/useCallback (они читают state через closure),
  // поэтому вычисляем primit-ключи прямо здесь для стабильного queryKey.
  const previewTargetKey = isLateBinding
    ? JSON.stringify({ covens: hostCriteria.covens.slice().sort() })
    : null;

  // Строим тело preview только при необходимости (lazy, только для late-binding).
  const buildPreviewBody = useCallback((): VoyageCreateRequest | null => {
    if (!isLateBinding) return null;
    const moduleName = commandState.moduleState
      ? `${commandState.moduleName}.${commandState.moduleState}`
      : commandState.moduleName;
    const c = parseIntOrEmpty(options.concurrency);
    const concurrency = c && c > 0 ? c : 50;
    const batch = options.batch.trim() || undefined;
    const max_failures = options.maxFailures.trim() || undefined;
    return {
      kind: 'command',
      module: moduleName,
      target: { coven: hostCriteria.covens },
      concurrency,
      batch_mode: options.batchMode,
      batch,
      max_failures,
      dry_run: false,
      require_alive: options.requireAlive,
      on_failure: options.onFailure,
    };
  }, [isLateBinding, commandState, hostCriteria.covens, options]);

  // Debounce target-key для preview-запроса: меняем queryKey только после settle target.
  const previewTargetKeyDebounced = useDebounce(previewTargetKey, 400);

  const previewQ = useQuery({
    queryKey: ['voyage.preview', previewTargetKeyDebounced, options.batchMode],
    queryFn: async () => {
      const body = buildPreviewBody();
      if (!body) return null;
      return keeperApi.voyages.preview(body);
    },
    enabled: isLateBinding && previewTargetKeyDebounced !== null && step === 4,
    staleTime: 30_000,
    retry: false,
  });

  // Самый дальний достижимый шаг по валидации (gate каждого шага). Stepper красит
  // «done» только реально пройденные шаги и запрещает прыжок вперёд за невалидный
  // шаг — раньше клик по номеру «4» красил все предыдущие done (белым), даже если
  // их данные не введены.
  const maxReachableStep = useMemo<1 | 2 | 3 | 4>(() => {
    if (!canAdvanceFromStep2) return 2;
    if (!canAdvanceFromStep3) return 3;
    return 4;
  }, [canAdvanceFromStep2, canAdvanceFromStep3]);

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>
            <Play size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Run
          </h1>
          <div className={pageStyles.crumbs}>{t('run:crumbs')}</div>
        </div>
      </div>

      <Stepper
        step={step}
        workload={workload}
        maxReachableStep={maxReachableStep}
        onJump={(s) => setStep(s)}
      />

      <div className={styles.body}>
        {step === 1 ? (
          <Step1
            workload={workload}
            onWorkloadChange={setWorkload}
            runMode={runMode}
            onRunModeChange={setRunMode}
          />
        ) : null}

        {step === 2 && workload === 'scenario' ? (
          <Step2ScenarioSelect value={scenarioState} onChange={setScenarioState} scenariosQ={scenariosQ} />
        ) : null}
        {step === 2 && workload === 'command' ? (
          <Step2CommandHosts
            value={hostCriteria}
            onChange={setHostCriteria}
            resolvedSouls={resolvedSouls}
            soulsLoading={soulsListQ.isLoading || soulprintLoading}
            invalidSoulprint={parsedSoulprint.invalid}
            regexError={sidRegexComp.error}
            runMode={runMode}
          />
        ) : null}

        {step === 3 && workload === 'scenario' ? (
          <Step3ScenarioIncarnations
            value={scenarioState}
            onChange={setScenarioState}
            incarnationsLoading={incarnationsListQ.isLoading}
            incarnationNames={incarnationNames}
            hostCountByIncarnation={hostCountByIncarnation}
            usePerField={usePerField}
            inputSchema={inputSchema}
            selectedScenarioMeta={selectedScenarioMeta}
            missingRequired={scenarioMissingRequired}
            invalidComposite={scenarioInvalidComposite}
            onInvalidMapChange={setScenarioInvalidMaps}
            onPatternErrorChange={setScenarioPatternErrors}
            directiveCatalog={directiveCatalog}
            directiveVersion={directiveVersion}
          />
        ) : null}
        {step === 3 && workload === 'command' ? (
          <Step3CommandParams
            value={commandState}
            onChange={setCommandState}
            missingRequired={commandMissingRequired}
            incarnationContext={hostCriteria.incarnations[0]}
            onInvalidMapChange={setCommandInvalidMaps}
            onPatternErrorChange={setCommandPatternErrors}
          />
        ) : null}

        {step === 4 ? (
          <Step4Options
            value={options}
            onChange={setOptions}
            workload={workload}
            scheduleAtValid={scheduleAtValid}
            batchValid={batchValid}
            runMode={runMode}
            cadenceState={cadenceState}
            onCadenceChange={setCadenceState}
            cadenceValid={cadenceValid}
            isLateBinding={isLateBinding}
            localBatchCount={localBatchCount}
            previewData={previewQ.data ?? null}
            previewLoading={previewQ.isLoading}
            snapshotScope={snapshotScope}
            notify={notify}
            onNotifyChange={setNotify}
          />
        ) : null}

        {submitError ? <div className={pageStyles.errorBox}>{submitError}</div> : null}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={goBack} disabled={step === 1}>
            <ArrowLeft size={14} /> {t('back')}
          </Button>
          {step < 4 ? (
            <Button
              type="button"
              variant="primary"
              onClick={goNext}
              disabled={(step === 2 && !canAdvanceFromStep2) || (step === 3 && !canAdvanceFromStep3)}
            >
              {t('next')} <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setSubmitError(null);
                submitMu.mutate();
              }}
              disabled={!canSubmit}
            >
              {runMode === 'cadence' ? (
                <>
                  <CalendarClock size={14} /> {submitMu.isPending ? t('running') : t('run:cadenceSubmitBtn')}
                </>
              ) : (
                <>
                  <Send size={14} /> {submitMu.isPending ? t('running') : t('run')}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({
  step,
  workload,
  maxReachableStep,
  onJump,
}: {
  step: 1 | 2 | 3 | 4;
  workload: Workload;
  // Самый дальний шаг, докуда дошла валидация. Шаг считается «done» (пройден),
  // только если он позади и его gate реально пройден; прыжок вперёд за этот
  // предел запрещён.
  maxReachableStep: 1 | 2 | 3 | 4;
  onJump: (s: 1 | 2 | 3 | 4) => void;
}) {
  const { t } = useTranslation();
  function labelFor(id: 1 | 2 | 3 | 4): string {
    if (id === 1) return t('run:stepWorkload');
    if (id === 2) return workload === 'scenario' ? t('run:stepScenario') : t('run:stepHosts');
    if (id === 3) return workload === 'scenario' ? t('run:stepIncarnations') : t('run:stepParams');
    return t('run:stepOptions');
  }
  return (
    <ol className={styles.steps} aria-label="Wizard steps">
      {STEPS.map((s) => {
        const active = s.id === step;
        // «done» = позади текущего И валидация дошла дальше него (gate пройден).
        const done = s.id < step && s.id < maxReachableStep;
        // Доступен клик: текущий, любой пройденный/назад, или следующий достижимый.
        const reachable = s.id <= Math.max(step, maxReachableStep);
        const cls = `${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`;
        return (
          <li key={s.id}>
            <button
              type="button"
              className={cls.trim()}
              onClick={() => reachable && onJump(s.id)}
              disabled={!reachable}
              aria-current={active ? 'step' : undefined}
            >
              <span className={styles.stepNum}>{s.id}.</span>
              {labelFor(s.id)}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Step1({
  workload,
  onWorkloadChange,
  runMode,
  onRunModeChange,
}: {
  workload: Workload;
  onWorkloadChange: (v: Workload) => void;
  runMode: RunMode;
  onRunModeChange: (v: RunMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Режим запуска: One-time / Recurring */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <label className={`${styles.radioCard} ${runMode === 'voyage' ? styles.radioCardActive : ''}`} style={{ flex: 1 }}>
          <input
            type="radio"
            name="run_mode"
            value="voyage"
            checked={runMode === 'voyage'}
            onChange={() => onRunModeChange('voyage')}
            aria-label={t('run:runModeVoyage')}
          />
          <Play size={18} style={{ marginTop: 2, color: 'var(--text-muted)' }} />
          <div>
            <div className={styles.radioTitle}>{t('run:runModeVoyage')}</div>
            <div className={styles.radioDesc}>{t('run:runModeVoyageDesc')}</div>
          </div>
        </label>
        <label className={`${styles.radioCard} ${runMode === 'cadence' ? styles.radioCardActive : ''}`} style={{ flex: 1 }}>
          <input
            type="radio"
            name="run_mode"
            value="cadence"
            checked={runMode === 'cadence'}
            onChange={() => onRunModeChange('cadence')}
            aria-label={t('run:runModeCadence')}
          />
          <CalendarClock size={18} style={{ marginTop: 2, color: 'var(--text-muted)' }} />
          <div>
            <div className={styles.radioTitle}>{t('run:runModeCadence')}</div>
            <div className={styles.radioDesc}>{t('run:runModeCadenceDesc')}</div>
          </div>
        </label>
      </div>

      {/* Выбор workload */}
      <div className={styles.radioRow} role="radiogroup" aria-label="Workload type">
        {WORKLOADS.map((w) => {
          const active = workload === w.kind;
          const Icon = w.icon;
          return (
            <label key={w.kind} className={`${styles.radioCard} ${active ? styles.radioCardActive : ''}`}>
              <input
                type="radio"
                name="workload"
                value={w.kind}
                checked={active}
                onChange={() => onWorkloadChange(w.kind)}
                aria-label={w.title}
              />
              <Icon size={18} style={{ marginTop: 2, color: 'var(--text-muted)' }} />
              <div>
                <div className={styles.radioTitle}>{w.title}</div>
                <div className={styles.radioDesc}>{t(w.descKey)}</div>
              </div>
            </label>
          );
        })}
      </div>
    </>
  );
}

interface ScenariosQueryResultMin {
  loading: boolean;
  unavailable: boolean;
  items: ServiceScenarioInfo[];
}

// Step 2 Scenario: выбор service → scenario.
function Step2ScenarioSelect({
  value,
  onChange,
  scenariosQ,
}: {
  value: ScenarioStateValues;
  onChange: (next: ScenarioStateValues) => void;
  scenariosQ: ScenariosQueryResultMin;
}) {
  const { t } = useTranslation();
  const servicesQ = useQuery({
    queryKey: ['run.services.list'],
    queryFn: () => keeperApi.services.list(),
  });

  return (
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Service</span>
        <select
          className={styles.field}
          value={value.service}
          onChange={(e) =>
            onChange({ ...value, service: e.target.value, scenario: '', incarnationRegex: '', incarnations: [] })
          }
        >
          <option value="">{t('run:selectServicePlaceholder')}</option>
          {(servicesQ.data?.items ?? []).map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.ref})
            </option>
          ))}
        </select>
      </label>

      {value.service ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Scenario</span>
          <select
            className={styles.field}
            value={value.scenario}
            onChange={(e) => onChange({ ...value, scenario: e.target.value })}
            disabled={scenariosQ.loading || scenariosQ.unavailable}
          >
            <option value="">{t('run:selectScenarioPlaceholder')}</option>
            {runnableScenarios(scenariosQ.items).map((s) => (
              <option key={s.name} value={s.name} title={s.description ?? ''}>
                {s.name}
                {s.description ? ` — ${s.description}` : ''}
              </option>
            ))}
          </select>
          {scenariosQ.unavailable ? (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {t('run:scenarioCatalogUnavailable')}
            </span>
          ) : null}
        </label>
      ) : null}
    </>
  );
}

// Step 3 Scenario: regex по имени incarnation → read-only список совпавших
// (фан-аут на ВСЕ совпавшие) + input-параметры сценария. Выбора (чекбоксов) нет:
// множество задаётся одной regex (концепция «scenario = запуск на N инкарнаций,
// выбранных regex»).
function Step3ScenarioIncarnations({
  value,
  onChange,
  incarnationsLoading,
  incarnationNames,
  hostCountByIncarnation,
  usePerField,
  inputSchema,
  selectedScenarioMeta,
  missingRequired,
  invalidComposite,
  onInvalidMapChange,
  onPatternErrorChange,
  directiveCatalog,
  directiveVersion,
}: {
  value: ScenarioStateValues;
  // Dispatch (а не plain-callback): два derived-эффекта ниже (defaults-seed и
  // matched-sync) используют функциональный апдейт, иначе их onced-closure `value`
  // затирал бы изменения друг друга (race между эффектами на одном рендере).
  onChange: Dispatch<SetStateAction<ScenarioStateValues>>;
  incarnationsLoading: boolean;
  incarnationNames: string[];
  hostCountByIncarnation: Record<string, number> | undefined;
  usePerField: boolean;
  inputSchema: ScenarioInputSchema | undefined;
  selectedScenarioMeta: ServiceScenarioInfo | undefined;
  missingRequired: string[];
  invalidComposite: string[];
  onInvalidMapChange?: (fields: string[]) => void;
  onPatternErrorChange?: (fields: string[]) => void;
  directiveCatalog?: DirectiveCatalogContext;
  directiveVersion?: string;
}) {
  const { t } = useTranslation();

  // Сидируем defaults при смене supported schema, но НЕ затираем уже введённые/
  // восстановленные из черновика значения (иначе re-mount шага сбрасывал бы input).
  useEffect(() => {
    if (usePerField && inputSchema) {
      onChange((prev) =>
        Object.keys(prev.fields).length === 0 ? { ...prev, fields: defaultsFromSchema(inputSchema) } : prev,
      );
    } else {
      onChange((prev) => (Object.keys(prev.fields).length > 0 ? { ...prev, fields: {} } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePerField, inputSchema]);

  // Компиляция regex.
  // `*` (ровно один символ) → специальный кейс «все»: матчит все incarnations сервиса.
  // Пустая строка (или только пробелы) → не задано, НЕВАЛИДНО (блокирует «Далее»).
  // Невалидная regex → 0 совпадений + ошибка.
  const filterRe = useMemo(() => {
    const r = value.incarnationRegex.trim();
    if (!r) return { re: null as RegExp | null, error: null as string | null, empty: true, matchAll: false };
    if (r === '*') return { re: null as RegExp | null, error: null as string | null, empty: false, matchAll: true };
    try {
      return { re: new RegExp(r), error: null as string | null, empty: false, matchAll: false };
    } catch (err) {
      return { re: null, error: err instanceof Error ? err.message : String(err), empty: false, matchAll: false };
    }
  }, [value.incarnationRegex]);

  const matched = useMemo(() => {
    if (filterRe.error || filterRe.empty) return [];
    if (filterRe.matchAll) return incarnationNames;
    return incarnationNames.filter((n) => filterRe.re!.test(n));
  }, [incarnationNames, filterRe]);

  // Множество для fan-out — производное от regex; синхронизируем в state, чтобы
  // submit/валидация видели актуальный список независимо от рендера шага.
  const matchedKey = matched.join('\n');
  useEffect(() => {
    onChange((prev) => (matchedKey === prev.incarnations.join('\n') ? prev : { ...prev, incarnations: matched }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedKey]);

  const totalHosts = useMemo(() => {
    if (!hostCountByIncarnation) return undefined;
    return matched.reduce((acc, n) => acc + (hostCountByIncarnation[n] ?? 0), 0);
  }, [hostCountByIncarnation, matched]);

  return (
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('run:incarnationRegexLabel')}</span>
        <input
          type="text"
          className={styles.field}
          value={value.incarnationRegex}
          onChange={(e) => onChange({ ...value, incarnationRegex: e.target.value })}
          placeholder={t('run:incarnationRegexPlaceholder')}
          aria-label="Incarnation regex"
        />
        <span className={styles.hint}>{t('run:incarnationRegexHint')}</span>
        {filterRe.empty ? <span className={styles.warn}>{t('run:incarnationRegexEmptyHint')}</span> : null}
        {filterRe.error ? <span className={styles.warn}>{t('run:incarnationRegexInvalid')}</span> : null}
      </label>

      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          {t('run:incarnationMatchedOf', { matched: matched.length, total: incarnationNames.length })}
        </div>
        <div
          style={{
            maxHeight: 240,
            overflow: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 8,
            background: 'var(--surface)',
          }}
          role="list"
          aria-label="Matched incarnations"
        >
          {incarnationsLoading ? <div className={pageStyles.loading}>{t('loading')}</div> : null}
          {!incarnationsLoading && matched.length === 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
              {t('run:incarnationNoMatch')}
            </div>
          ) : null}
          {matched.map((name) => {
            const count = hostCountByIncarnation?.[name];
            return (
              <div
                key={name}
                role="listitem"
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '4px 2px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                }}
              >
                {name}
                <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                  {count === undefined ? t('run:hostCountUnknown') : t('run:hostCount', { count })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.preview} aria-label="Incarnation preview">
        <div>
          <Badge tone={matched.length > 0 ? 'info' : 'muted'}>
            {t('run:incarnationRunOnN', { count: matched.length })}
          </Badge>
          {totalHosts !== undefined ? (
            <>
              {' '}
              <Badge tone="info">{t('run:totalHosts', { count: totalHosts })}</Badge>
            </>
          ) : null}
        </div>
      </div>

      {usePerField && inputSchema ? (
        <div>
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
            {t('run:scenarioInputFieldsLabel', { scenario: value.scenario })}
          </div>
          <ScenarioInputFields
            schema={inputSchema}
            value={value.fields}
            onChange={(next) => onChange({ ...value, fields: next })}
            showErrors={missingRequired.length > 0 || invalidComposite.length > 0}
            onInvalidMapChange={onInvalidMapChange}
            onPatternErrorChange={onPatternErrorChange}
            form={selectedScenarioMeta?.form}
            directiveCatalog={directiveCatalog}
            directiveVersion={directiveVersion}
          />
          {selectedScenarioMeta?.description ? (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-faint)' }}>
              {selectedScenarioMeta.description}
            </div>
          ) : null}
        </div>
      ) : (
        <div>
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
            {t('run:scenarioInputDynamicLabel')}
          </div>
          <DynamicInputBuilder
            value={value.inputObj}
            onChange={(next) => onChange({ ...value, inputObj: next })}
            ariaLabel="Scenario input fields"
          />
        </div>
      )}
    </>
  );
}

// Step 2 Command: rich host selector. Критерии комбинируются (AND между разными,
// OR внутри списка). Live-preview резолвнутого списка + counter.
function Step2CommandHosts({
  value,
  onChange,
  resolvedSouls,
  soulsLoading,
  invalidSoulprint,
  regexError,
  runMode,
}: {
  value: HostCriteria;
  onChange: (next: HostCriteria) => void;
  resolvedSouls: SoulListEntry[];
  soulsLoading: boolean;
  invalidSoulprint: string[];
  regexError: string | null;
  runMode: RunMode;
}) {
  const { t } = useTranslation();
  const sample = resolvedSouls.slice(0, 50);
  const active = hasAnyCriteria(value);

  // Footgun-плашки для Cadence (late-binding предупреждения).
  // earlyBinding: coven задан, но также есть regex/soulprint — они snapshot-only.
  const cadenceEarlyBindingWarn =
    runMode === 'cadence' &&
    value.covens.length > 0 &&
    (value.sidRegex.trim().length > 0 || value.soulprint.trim().length > 0);
  // snapshotOnly: нет coven, но есть regex/soulprint — весь target будет snapshot.
  const cadenceSnapshotOnlyWarn =
    runMode === 'cadence' &&
    value.covens.length === 0 &&
    (value.sidRegex.trim().length > 0 || value.soulprint.trim().length > 0);

  return (
    <>
      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          {t('run:hostIncarnationsLabel')}
        </div>
        <ChipsInput
          value={value.incarnations}
          onChange={(next) => onChange({ ...value, incarnations: next })}
          placeholder={t('run:hostIncarnationsPlaceholder')}
          ariaLabel="Incarnations criterion"
          validate={(v) => (NAME_REGEX.test(v) ? null : t('run:covenKebabShortError'))}
        />
      </div>

      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          {t('run:covenLabelsLabel')}
        </div>
        <ChipsInput
          value={value.covens}
          onChange={(next) => onChange({ ...value, covens: next })}
          placeholder={t('run:covenLabelsPlaceholder')}
          ariaLabel="Coven labels"
          validate={(v) => (NAME_REGEX.test(v) ? null : t('run:covenKebabShortError'))}
        />
      </div>

      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('run:sidRegexLabel')}</span>
        <input
          type="text"
          className={styles.field}
          value={value.sidRegex}
          onChange={(e) => onChange({ ...value, sidRegex: e.target.value })}
          placeholder={t('run:sidRegexPlaceholder')}
          aria-label="SID regex"
        />
        <span className={styles.hint}>{t('run:sidRegexHint')}</span>
        {regexError ? <span className={styles.warn}>{regexError}</span> : null}
      </label>

      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('run:soulprintLabel')}</span>
        <input
          type="text"
          className={styles.field}
          value={value.soulprint}
          onChange={(e) => onChange({ ...value, soulprint: e.target.value })}
          placeholder={t('run:soulprintPlaceholder')}
          aria-label="Soulprint filter"
        />
        {invalidSoulprint.length > 0 ? (
          <span className={styles.warn}>
            {t('run:soulprintUnrecognized', { tokens: invalidSoulprint.join(', ') })}
          </span>
        ) : null}
      </label>

      {/* Footgun-предупреждения для Cadence: показываем над preview */}
      {cadenceSnapshotOnlyWarn ? (
        <div className={styles.warn} data-testid="cadence-snapshot-only-warn" style={{ marginBottom: 4 }}>
          {t('run:cadenceSnapshotOnlyWarn')}
        </div>
      ) : null}
      {cadenceEarlyBindingWarn ? (
        <div className={styles.warn} data-testid="cadence-early-binding-warn" style={{ marginBottom: 4 }}>
          {t('run:cadenceEarlyBindingWarn')}
        </div>
      ) : null}

      <div className={styles.preview} aria-label="Host preview">
        {!active ? (
          <div>{t('run:hostCriteriaEmpty')}</div>
        ) : (
          <>
            <div>
              <Badge tone="info">{t('run:hostsMatch', { count: resolvedSouls.length })}</Badge>
              {soulsLoading ? <span style={{ marginLeft: 8 }}>{t('loading')}</span> : null}
            </div>
            {sample.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                {sample.map((s) => (
                  <div key={s.sid}>{s.sid}</div>
                ))}
                {resolvedSouls.length > sample.length ? (
                  <div style={{ color: 'var(--text-faint)' }}>
                    {t('run:hostsMore', { count: resolvedSouls.length - sample.length })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!soulsLoading && resolvedSouls.length === 0 ? (
              <span className={styles.warn}>{t('run:targetEmptyError')}</span>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

// Step 3 Command: module-search (каталог GET /v1/modules) + типизированная
// форма params / cmd-поля / free-text fallback.
function Step3CommandParams({
  value,
  onChange,
  missingRequired,
  incarnationContext,
  onInvalidMapChange,
  onPatternErrorChange,
}: {
  value: CommandStateValues;
  onChange: (next: CommandStateValues) => void;
  missingRequired: string[];
  incarnationContext?: string;
  onInvalidMapChange?: (fields: string[]) => void;
  onPatternErrorChange?: (fields: string[]) => void;
}) {
  const { t } = useTranslation();
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);

  // При первом рендере moduleParams может быть пуст (state инициализирован дефолтом без
  // обращения к каталогу). Подтягиваем params из React Query кэша когда каталог загрузится.
  // queryKey совпадает с ModulePicker(errandSafe=true) → единый кэш, нет дублирующего запроса.
  const catalogQ = useQuery({
    queryKey: ['modules.catalog', true] as const,
    queryFn: () => keeperApi.modules.list({ errand_safe: true }),
    retry: false,
  });
  useEffect(() => {
    if (!catalogQ.data || hasParams(value.moduleParams) || !value.moduleName) return;
    const item = (catalogQ.data.items ?? []).find((m) => m.name === value.moduleName);
    if (!item || !hasParams(item.params ?? undefined)) return;
    onChange({
      ...value,
      moduleStates: item.states ?? value.moduleStates,
      moduleKind: item.kind,
      moduleParams: item.params ?? [],
      paramFields: defaultsFromSchema(paramsToInputSchema(item.params ?? undefined)),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQ.data]);

  // Выбор модуля из каталога: применяем имя, kind, params и первый state.
  // Сбрасываем форму (cmd / paramFields), чтобы не нести значения старого модуля.
  function onSelectModule(item: ModuleCatalogItem) {
    const states = item.states ?? [];
    const next: CommandStateValues = {
      ...value,
      moduleName: item.name,
      moduleState: states[0] ?? '',
      moduleStates: states,
      moduleKind: item.kind,
      moduleParams: item.params ?? [],
      paramFields: hasParams(item.params ?? undefined) ? defaultsFromSchema(paramsToInputSchema(item.params ?? undefined)) : {},
    };
    onChange(next);
  }

  const showParamsForm = hasParams(value.moduleParams);
  const paramsSchema = useMemo(() => paramsToInputSchema(value.moduleParams), [value.moduleParams]);

  return (
    <>
      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Module</span>
        {catalogUnavailable ? (
          <>
            <input
              type="text"
              className={styles.field}
              value={value.moduleName}
              onChange={(e) =>
                onChange({ ...value, moduleName: e.target.value, moduleState: '', moduleStates: [], moduleParams: [] })
              }
              placeholder={t('run:moduleNamePlaceholder')}
              aria-label="Custom module name"
              data-testid="module-freetext"
            />
            <span className={styles.hint}>{t('run:moduleCatalogUnavailable')}</span>
          </>
        ) : (
          <ModulePicker
            value={value.moduleName}
            onSelect={onSelectModule}
            errandSafe
            onUnavailable={() => setCatalogUnavailable(true)}
          />
        )}
      </div>

      {/* Выбор state, если у модуля их несколько (полный адрес — name.state). */}
      <CommandStateSelect value={value} onChange={onChange} />

      {showParamsForm ? (
        <div data-testid="module-params-form">
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
            {t('run:moduleParamsLabel', { module: value.moduleName })}
          </div>
          <ScenarioInputFields
            schema={paramsSchema}
            value={value.paramFields}
            onChange={(next) => onChange({ ...value, paramFields: next })}
            showErrors={missingRequired.length > 0}
            incarnationContext={incarnationContext}
            moduleName={value.moduleName}
            onInvalidMapChange={onInvalidMapChange}
            onPatternErrorChange={onPatternErrorChange}
          />
        </div>
      ) : value.moduleName ? (
        <div data-testid="module-dynamic-input">
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
            {t('run:inputLabel')}
          </div>
          <DynamicInputBuilder
            value={value.customInput}
            onChange={(next) => onChange({ ...value, customInput: next })}
            ariaLabel="Custom module input fields"
          />
        </div>
      ) : null}

      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('run:timeoutLabel')}</span>
        <input
          type="number"
          className={styles.field}
          min={1}
          max={3600}
          value={value.timeoutSeconds}
          onChange={(e) => onChange({ ...value, timeoutSeconds: parseInt(e.target.value, 10) || 0 })}
          aria-label="Timeout seconds"
        />
      </label>
    </>
  );
}

// Выбор state-суффикса, если у выбранного модуля их несколько (`core.service` —
// running/stopped/...). При единственном/нулевом state секция скрыта (state
// уже выставлен onSelectModule). Полный адрес submit-а — `moduleName.moduleState`.
function CommandStateSelect({
  value,
  onChange,
}: {
  value: CommandStateValues;
  onChange: (next: CommandStateValues) => void;
}) {
  const { t } = useTranslation();
  if (value.moduleStates.length < 2) return null;
  return (
    <label className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{t('run:moduleStateLabel')}</span>
      <select
        className={styles.field}
        value={value.moduleState}
        onChange={(e) => onChange({ ...value, moduleState: e.target.value })}
        aria-label="Module state"
        data-testid="module-state-select"
      >
        {value.moduleStates.map((s) => (
          <option key={s} value={s}>
            {value.moduleName}.{s}
          </option>
        ))}
      </select>
    </label>
  );
}

function Step4Options({
  value,
  onChange,
  workload,
  scheduleAtValid,
  batchValid,
  runMode,
  cadenceState,
  onCadenceChange,
  cadenceValid,
  isLateBinding,
  localBatchCount,
  previewData,
  previewLoading,
  snapshotScope,
  notify,
  onNotifyChange,
}: {
  value: OptionsState;
  onChange: (next: OptionsState) => void;
  workload: Workload;
  scheduleAtValid: boolean;
  batchValid: boolean;
  runMode: RunMode;
  cadenceState: CadenceState;
  onCadenceChange: (next: CadenceState) => void;
  cadenceValid: boolean;
  isLateBinding: boolean;
  localBatchCount: number | null;
  previewData: VoyagePreviewReply | null;
  previewLoading: boolean;
  snapshotScope: number;
  notify: VoyageNotify[];
  onNotifyChange: (next: VoyageNotify[]) => void;
}) {
  const { t } = useTranslation();
  const isWindow = value.batchMode === 'window';

  // Вычисляем UTC-эквивалент заполненного поля для отображения рядом с hint.
  const scheduleAtUtc = useMemo(() => {
    const s = value.scheduleAt.trim();
    if (!s) return null;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toUTCString();
  }, [value.scheduleAt]);

  return (
    <>
      {/* Секция «Батчинг» — размер/порог пачки + поведение при провале batch-раннера
          (on_failure логически про сам батчинг, не про время запуска). */}
      <fieldset className={styles.optionsSection}>
        <legend className={styles.optionsSectionLegend}>{t('run:sectionBatchingLabel')}</legend>

        {/* Batch mode */}
        <fieldset
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
        >
          <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
            {t('run:batchModeLabel')}
          </legend>
          <div style={{ display: 'flex', gap: 14 }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="radio"
                name="batch_mode"
                value="barrier"
                checked={value.batchMode === 'barrier'}
                onChange={() => onChange({ ...value, batchMode: 'barrier' })}
                aria-label="batch_mode_barrier"
              />
              barrier
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="radio"
                name="batch_mode"
                value="window"
                checked={value.batchMode === 'window'}
                onChange={() => onChange({ ...value, batchMode: 'window', batch: '' })}
                aria-label="batch_mode_window"
              />
              window
            </label>
          </div>
          <div className={styles.hint} style={{ marginTop: 6 }}>
            {isWindow ? t('run:batchModeWindowHint') : t('run:batchModeBarrierHint')}
          </div>
        </fieldset>

        {/* Единое текстовое поле batch (N | N%) — скрыть при window */}
        {!isWindow ? (
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('run:batchLabel')}</span>
            <input
              type="text"
              className={styles.field}
              value={value.batch}
              onChange={(e) => onChange({ ...value, batch: e.target.value })}
              placeholder={t('run:batchPlaceholder')}
              aria-label="Batch"
            />
            <span className={styles.hint}>{t('run:batchHint')}</span>
            {!batchValid && value.batch.trim() ? (
              <span className={styles.warn}>{t('run:batchError')}</span>
            ) : null}
          </label>
        ) : (
          <div className={styles.hint} style={{ marginTop: 4 }}>
            {t('run:batchSizeWindowHidden')}
          </div>
        )}

        {/* max_failures — всегда видимо (работает в обоих batch_mode) */}
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>
            {t('run:maxFailuresLabel')}
            {' '}
            <span
              title={t('run:maxFailuresTooltip')}
              style={{ cursor: 'help', color: 'var(--text-faint)', fontSize: 12 }}
              aria-label={t('run:maxFailuresTooltip')}
            >
              (?)
            </span>
          </span>
          <input
            type="text"
            className={styles.field}
            value={value.maxFailures}
            onChange={(e) => onChange({ ...value, maxFailures: e.target.value })}
            placeholder={t('run:maxFailuresPlaceholder')}
            aria-label="Max failures"
          />
          <span className={styles.hint}>{t('run:maxFailuresHint')}</span>
        </label>

        {/* Предпоказ числа батчей */}
        {!isWindow && (isLateBinding ? (
          previewLoading ? (
            <div className={styles.hint} aria-label="batch preview">
              {t('run:batchPreviewLoading')}
            </div>
          ) : previewData ? (
            <div className={styles.hint} aria-label="batch preview" data-testid="batch-preview">
              {previewData.batch_mode === 'window'
                ? t('run:batchPreviewWindow')
                : t('run:batchPreviewBatches', { count: previewData.total_batches, scope: previewData.scope_size })}
            </div>
          ) : null
        ) : (
          localBatchCount !== null && snapshotScope > 0 ? (
            <div className={styles.hint} aria-label="batch preview" data-testid="batch-preview">
              {t('run:batchPreviewBatches', { count: localBatchCount, scope: snapshotScope })}
            </div>
          ) : null
        ))}

        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('run:concurrencyLabel')}</span>
          <input
            type="number"
            className={styles.field}
            min={1}
            max={500}
            value={value.concurrency}
            onChange={(e) => onChange({ ...value, concurrency: e.target.value })}
            aria-label="Concurrency"
          />
          <span className={styles.hint}>
            {isWindow ? t('run:concurrencyWindowHint') : t('run:concurrencyHint')}
          </span>
        </label>

        <fieldset
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
        >
          <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
            {t('run:onFailureLabel')}
          </legend>
          <div style={{ display: 'flex', gap: 14 }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="radio"
                name="on_failure"
                value="abort"
                checked={value.onFailure === 'abort'}
                onChange={() => onChange({ ...value, onFailure: 'abort' })}
              />
              abort
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="radio"
                name="on_failure"
                value="continue"
                checked={value.onFailure === 'continue'}
                onChange={() => onChange({ ...value, onFailure: 'continue' })}
              />
              continue
            </label>
          </div>
        </fieldset>

        {/* inter_batch_interval_ms — только для barrier */}
        {!isWindow ? (
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('run:interBatchIntervalLabel')}</span>
            <input
              type="number"
              className={styles.field}
              min={0}
              value={value.interBatchIntervalMs}
              onChange={(e) => onChange({ ...value, interBatchIntervalMs: e.target.value })}
              placeholder={t('run:interBatchIntervalPlaceholder')}
              aria-label="Inter-batch interval ms"
            />
            <span className={styles.hint}>{t('run:interBatchIntervalHint')}</span>
          </label>
        ) : null}

        {/* inter_unit_interval_ms — только для window */}
        {isWindow ? (
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('run:interUnitIntervalLabel')}</span>
            <input
              type="number"
              className={styles.field}
              min={0}
              value={value.interUnitIntervalMs}
              onChange={(e) => onChange({ ...value, interUnitIntervalMs: e.target.value })}
              placeholder={t('run:interUnitIntervalPlaceholder')}
              aria-label="Inter-unit interval ms"
            />
            <span className={styles.hint}>{t('run:interUnitIntervalHint')}</span>
          </label>
        ) : null}
      </fieldset>

      {/* Секция «Планирование» — когда стартует прогон: разово (schedule_at) или
          по расписанию (Cadence: interval/cron/overlap_policy). */}
      <fieldset className={styles.optionsSection}>
        <legend className={styles.optionsSectionLegend}>{t('run:sectionSchedulingLabel')}</legend>

        {runMode === 'cadence' ? (
          /* Cadence-поля вместо scheduleAt */
          <fieldset
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
          >
            <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
              {t('run:cadenceScheduleLabel')}
            </legend>

            {/* Имя Cadence */}
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:cadenceNameLabel')}</span>
              <input
                type="text"
                className={styles.field}
                value={cadenceState.cadenceName}
                onChange={(e) => onCadenceChange({ ...cadenceState, cadenceName: e.target.value })}
                placeholder={t('run:cadenceNamePlaceholder')}
                aria-label="Cadence name"
                data-testid="cadence-name"
              />
              {!cadenceState.cadenceName.trim() && !cadenceValid ? (
                <span className={styles.warn}>{t('run:cadenceNameRequired')}</span>
              ) : null}
            </label>

            {/* schedule_kind */}
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:cadenceKindLabel')}</span>
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="radio"
                    name="schedule_kind"
                    value="interval"
                    checked={cadenceState.scheduleKind === 'interval'}
                    onChange={() => onCadenceChange({ ...cadenceState, scheduleKind: 'interval' })}
                    aria-label="schedule_kind_interval"
                  />
                  {t('run:cadenceKindInterval')}
                </label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="radio"
                    name="schedule_kind"
                    value="cron"
                    checked={cadenceState.scheduleKind === 'cron'}
                    onChange={() => onCadenceChange({ ...cadenceState, scheduleKind: 'cron' })}
                    aria-label="schedule_kind_cron"
                  />
                  {t('run:cadenceKindCron')}
                </label>
              </div>
            </div>

            {cadenceState.scheduleKind === 'interval' ? (
              <label className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('run:cadenceIntervalLabel')}</span>
                <input
                  type="number"
                  className={styles.field}
                  min={CONSTRAINTS.cadenceIntervalSecondsMin}
                  value={cadenceState.intervalSeconds}
                  onChange={(e) => onCadenceChange({ ...cadenceState, intervalSeconds: e.target.value })}
                  placeholder="3600"
                  aria-label="Interval seconds"
                  data-testid="cadence-interval"
                />
                <span className={styles.hint}>{t('run:cadenceIntervalHint', { min: CONSTRAINTS.cadenceIntervalSecondsMin })}</span>
              </label>
            ) : (
              <label className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('run:cadenceCronLabel')}</span>
                <input
                  type="text"
                  className={styles.field}
                  value={cadenceState.cronExpr}
                  onChange={(e) => onCadenceChange({ ...cadenceState, cronExpr: e.target.value })}
                  placeholder="0 */6 * * *"
                  aria-label="Cron expression"
                  data-testid="cadence-cron"
                />
                <span className={styles.hint}>{t('run:cadenceCronHint')}</span>
              </label>
            )}

            {/* overlap_policy */}
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:cadenceOverlapLabel')}</span>
              <select
                className={styles.field}
                value={cadenceState.overlapPolicy}
                onChange={(e) => onCadenceChange({ ...cadenceState, overlapPolicy: e.target.value as CadenceOverlapPolicy })}
                aria-label="Overlap policy"
                data-testid="cadence-overlap"
              >
                <option value="skip">{t('run:cadenceOverlapSkip')}</option>
                <option value="queue">{t('run:cadenceOverlapQueue')}</option>
                <option value="parallel">{t('run:cadenceOverlapParallel')}</option>
              </select>
              <span className={styles.hint}>{t(`run:cadenceOverlapHint_${cadenceState.overlapPolicy}`)}</span>
            </label>
          </fieldset>
        ) : (
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('run:scheduleAtLabel')}</span>
            <input
              type="datetime-local"
              className={styles.field}
              value={value.scheduleAt}
              onChange={(e) => onChange({ ...value, scheduleAt: e.target.value })}
              aria-label="Schedule at"
            />
            <span className={styles.hint}>{t('run:scheduleAtHint')}</span>
            {scheduleAtUtc ? <span className={styles.hint}>{t('run:scheduleAtUtc', { utc: scheduleAtUtc })}</span> : null}
            {!scheduleAtValid ? <span className={styles.warn}>{t('run:scheduleAtPastError')}</span> : null}
          </label>
        )}
      </fieldset>

      {/* Секция «Флаги» — булевы переключатели поведения прогона. */}
      <fieldset className={styles.optionsSection}>
        <legend className={styles.optionsSectionLegend}>{t('run:sectionFlagsLabel')}</legend>

        {workload === 'scenario' ? (
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={value.dryRun}
              onChange={(e) => onChange({ ...value, dryRun: e.target.checked })}
              aria-label="dry_run"
            />
            {t('run:dryRunLabel')}
          </label>
        ) : null}
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={value.requireAlive}
            onChange={(e) => onChange({ ...value, requireAlive: e.target.checked })}
            aria-label="require_alive"
          />
          {t('run:requireAliveLabel')}
          {workload === 'scenario' ? (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {' '}({t('run:requireAliveScenarioNote')})
            </span>
          ) : null}
        </label>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={value.wait}
            onChange={(e) => onChange({ ...value, wait: e.target.checked })}
            aria-label="wait"
          />
          {t('run:waitLabel')}
        </label>
      </fieldset>

      {/* Блок уведомлений — для Voyage (разовые) и Cadence (постоянные, mode=permanent) */}
      <NotifyBlock
        value={notify}
        onChange={onNotifyChange}
        mode={runMode === 'cadence' ? 'permanent' : 'ephemeral'}
      />
    </>
  );
}

// --- helpers ---

// Восстановление host-criteria из URL search-params (bulk-run actions со
// списочных страниц). target_coven → covens; target_regex → sidRegex;
// target_sids → sidRegex anchored-OR (точный список SID); target_where (raw CEL)
// и target_glob в criteria-DSL не маппятся — игнорируются.
function criteriaFromQuery(params: URLSearchParams): HostCriteria {
  const covenRaw = params.get('target_coven');
  const regexRaw = params.get('target_regex');
  const sidsRaw = params.get('target_sids');
  const covens = covenRaw ? splitCsv(covenRaw) : [];
  let sidRegex = regexRaw ?? '';
  if (!sidRegex && sidsRaw) {
    const sids = splitCsv(sidsRaw);
    if (sids.length > 0) {
      const escaped = sids.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
      sidRegex = `^(${escaped.join('|')})$`;
    }
  }
  return { incarnations: [], covens, sidRegex, soulprint: '' };
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}


function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseIntOrEmpty(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? undefined : n;
}

// Простой debounce-хук: возвращает debounced-значение с задержкой ms.
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay]);
  return debounced;
}
