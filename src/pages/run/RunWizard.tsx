import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { Play, ArrowLeft, ArrowRight, Send, Box, Terminal, CalendarClock } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
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
  VoyageTarget,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useServiceScenarios } from '../incarnations/useServiceScenarios';
import { runnableScenarios } from '../incarnations/reservedScenarios';
import { ScenarioInputFields } from '../incarnations/ScenarioInputFields';
import {
  defaultsFromSchema,
  invalidCompositeFields,
  isSupportedInputSchema,
  missingRequiredFields,
  serializeFields,
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
  // Опциональный размер батча (Leg): N инкарнаций/хостов за раз.
  // Пусто/0 — весь scope одним прогоном. Доступно для обоих workload (window игнорирует его).
  batchSize: string;
  concurrency: string;
  // VoyageOnFailure = 'abort' | 'continue' (супerset ErrandRunOnFailure).
  onFailure: VoyageOnFailure;
  dryRun: boolean;
  wait: boolean;
  // Отложенный старт (ISO-8601). Пусто → немедленный старт.
  scheduleAt: string;
  // Режим батчинга (ADR-043). barrier = последовательные Leg-и (дефолт); window = скользящее окно.
  batchMode: VoyageBatchMode;
  // % от scope (1-100). Взаимоисключающий с batchSize.
  // batchSizeMode = 'abs' | 'pct' — radio-выбор.
  batchSizeMode: 'abs' | 'pct';
  batchPercent: string;
  // Порог провалов: остановить после N. Пусто = поведение по on_failure.
  failThreshold: string;
  // Пауза между Leg-ами в ms (barrier). Пусто = без паузы.
  interBatchIntervalMs: string;
  // Пауза между единицами окна в ms (window). Пусто = без паузы.
  interUnitIntervalMs: string;
  // Presence-фильтр: только живые хосты. Применяется к kind=command.
  requireAlive: boolean;
}

const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

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
const DRAFT_VERSION = 8;

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
  batchSize: '',
  concurrency: '50',
  onFailure: 'abort',
  dryRun: false,
  wait: false,
  scheduleAt: '',
  batchMode: 'barrier',
  batchSizeMode: 'abs',
  batchPercent: '',
  failThreshold: '',
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
      ['workload', 'service', 'scenario', 'incarnation', 'module', 'target_coven', 'target_regex', 'target_sids'].some(
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
    return {
      ...DEFAULT_SCENARIO_STATE,
      service: initialService,
      scenario: initialScenario,
      // Deep-link на конкретную incarnation → anchored-exact regex (фан-аут на неё одну).
      incarnationRegex: initialIncarnation ? `^${escapeRegex(initialIncarnation)}$` : '',
      incarnations: initialIncarnation ? [initialIncarnation] : [],
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
    const payload: WizardDraft = { v: DRAFT_VERSION, step, workload, runMode, scenarioState, commandState, hostCriteria, options, cadenceState };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage недоступен (private-mode/quota) — persist опционален, не падаем.
    }
  }, [step, workload, runMode, scenarioState, commandState, hostCriteria, options, cadenceState]);

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
  const scenarioMissingRequired = useMemo(
    () => (workload === 'scenario' && usePerField ? missingRequiredFields(inputSchema, scenarioState.fields) : []),
    [workload, usePerField, inputSchema, scenarioState.fields],
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

    // XOR batch_size / batch_percent: шлём только активный режим.
    // window не использует batch_size (ширина окна = concurrency) — не шлём.
    const batchSize =
      batchMode !== 'window' && options.batchSizeMode === 'abs'
        ? parseIntOrEmpty(options.batchSize)
        : undefined;
    const batchPercent =
      batchMode !== 'window' && options.batchSizeMode === 'pct'
        ? parseIntOrEmpty(options.batchPercent)
        : undefined;

    const failThreshold = parseIntOrEmpty(options.failThreshold);
    const interBatchMs =
      batchMode === 'barrier' ? parseIntOrEmpty(options.interBatchIntervalMs) : undefined;
    const interUnitMs =
      batchMode === 'window' ? parseIntOrEmpty(options.interUnitIntervalMs) : undefined;

    return {
      concurrency,
      batch_mode: batchMode,
      batch_size: batchSize && batchSize > 0 ? batchSize : undefined,
      batch_percent: batchPercent && batchPercent >= 1 && batchPercent <= 100 ? batchPercent : undefined,
      fail_threshold: failThreshold && failThreshold > 0 ? failThreshold : undefined,
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

  /** Строит recipe-часть (kind + workload-поля + target), общую для voyage и cadence. */
  function buildRecipePayload(): RecipePayload {
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
      // UI уже резолвил rich-criteria в явный список SID — шлём через target.sids.
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
    const reply = await keeperApi.voyages.create({
      ...recipe,
      dry_run: Boolean(options.dryRun),
      require_alive: options.requireAlive,
      ...opts,
    });
    return `/voyages/${encodeURIComponent(reply.voyage_id)}`;
  }

  async function submitCommand(): Promise<string> {
    const recipe = buildRecipePayload();
    const opts = buildOptionsPayload();
    const reply = await keeperApi.voyages.create({
      ...recipe,
      dry_run: false,
      require_alive: options.requireAlive,
      ...opts,
    });
    return `/voyages/${encodeURIComponent(reply.voyage_id)}`;
  }

  async function submitCadence(): Promise<string> {
    const recipe = buildRecipePayload();
    const opts = buildOptionsPayload();
    const intervalSec = parseIntOrEmpty(cadenceState.intervalSeconds);
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
    });
    return `/cadences/${encodeURIComponent(reply.cadence_id)}`;
  }

  // batchSize — опциональное поле; если задано, должно быть целым 1..10000
  // (верхняя граница = max_scope-дефолт backend). При window или batchSizeMode=pct — не валидируем.
  const batchSizeValid = useMemo(() => {
    if (options.batchMode === 'window' || options.batchSizeMode !== 'abs') return true;
    const s = options.batchSize.trim();
    if (!s) return true; // пусто — ok (весь scope одним прогоном)
    const n = parseIntOrEmpty(s);
    return Boolean(n && n >= 1 && n <= 10000);
  }, [options.batchSize, options.batchMode, options.batchSizeMode]);

  // batchPercent — опционально; если задан, 1..100.
  const batchPercentValid = useMemo(() => {
    if (options.batchSizeMode !== 'pct') return true;
    const s = options.batchPercent.trim();
    if (!s) return true;
    const n = parseIntOrEmpty(s);
    return Boolean(n && n >= 1 && n <= 100);
  }, [options.batchPercent, options.batchSizeMode]);

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
      return Boolean(s && s >= 60);
    }
    // cron: непустая строка (формат проверяет backend)
    return cadenceState.cronExpr.trim().length > 0;
  }, [runMode, cadenceState]);

  const canSubmit = canAdvanceFromStep2 && canAdvanceFromStep3 && batchSizeValid && batchPercentValid && (runMode === 'cadence' ? cadenceValid : scheduleAtValid) && !submitMu.isPending;

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
            batchSizeValid={batchSizeValid}
            batchPercentValid={batchPercentValid}
            runMode={runMode}
            cadenceState={cadenceState}
            onCadenceChange={setCadenceState}
            cadenceValid={cadenceValid}
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
}: {
  value: HostCriteria;
  onChange: (next: HostCriteria) => void;
  resolvedSouls: SoulListEntry[];
  soulsLoading: boolean;
  invalidSoulprint: string[];
  regexError: string | null;
}) {
  const { t } = useTranslation();
  const sample = resolvedSouls.slice(0, 50);
  const active = hasAnyCriteria(value);

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
    const item = catalogQ.data.items.find((m) => m.name === value.moduleName);
    if (!item || !hasParams(item.params)) return;
    onChange({
      ...value,
      moduleStates: item.states ?? value.moduleStates,
      moduleKind: item.kind,
      moduleParams: item.params ?? [],
      paramFields: defaultsFromSchema(paramsToInputSchema(item.params ?? [])),
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
      paramFields: hasParams(item.params) ? defaultsFromSchema(paramsToInputSchema(item.params)) : {},
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
  batchSizeValid,
  batchPercentValid,
  runMode,
  cadenceState,
  onCadenceChange,
  cadenceValid,
}: {
  value: OptionsState;
  onChange: (next: OptionsState) => void;
  workload: Workload;
  scheduleAtValid: boolean;
  batchSizeValid: boolean;
  batchPercentValid: boolean;
  runMode: RunMode;
  cadenceState: CadenceState;
  onCadenceChange: (next: CadenceState) => void;
  cadenceValid: boolean;
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
              onChange={() => onChange({ ...value, batchMode: 'window', batchSizeMode: 'abs' })}
              aria-label="batch_mode_window"
            />
            window
          </label>
        </div>
        <div className={styles.hint} style={{ marginTop: 6 }}>
          {isWindow ? t('run:batchModeWindowHint') : t('run:batchModeBarrierHint')}
        </div>
      </fieldset>

      {/* Batch size / percent — скрыть при window (не используется) */}
      {!isWindow ? (
        <>
          {/* Radio: абсолютный / процент */}
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('run:batchSizeModeLabel')}</span>
            <div style={{ display: 'flex', gap: 14 }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="batch_size_mode"
                  value="abs"
                  checked={value.batchSizeMode === 'abs'}
                  onChange={() => onChange({ ...value, batchSizeMode: 'abs', batchPercent: '' })}
                  aria-label="batch_size_mode_abs"
                />
                {t('run:batchSizeModeAbs')}
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="batch_size_mode"
                  value="pct"
                  checked={value.batchSizeMode === 'pct'}
                  onChange={() => onChange({ ...value, batchSizeMode: 'pct', batchSize: '' })}
                  aria-label="batch_size_mode_pct"
                />
                {t('run:batchSizeModePct')}
              </label>
            </div>
          </div>

          {value.batchSizeMode === 'abs' ? (
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:batchSizeLabel')}</span>
              <input
                type="number"
                className={styles.field}
                min={1}
                value={value.batchSize}
                onChange={(e) => onChange({ ...value, batchSize: e.target.value })}
                placeholder={t('run:batchSizePlaceholder')}
                aria-label="Batch size"
              />
              <span className={styles.hint}>{t('run:batchSizeHint')}</span>
              {!batchSizeValid && value.batchSize.trim() ? (
                <span className={styles.warn}>{t('run:batchSizeError')}</span>
              ) : null}
            </label>
          ) : (
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:batchPercentLabel')}</span>
              <input
                type="number"
                className={styles.field}
                min={1}
                max={100}
                value={value.batchPercent}
                onChange={(e) => onChange({ ...value, batchPercent: e.target.value })}
                placeholder={t('run:batchPercentPlaceholder')}
                aria-label="Batch percent"
              />
              <span className={styles.hint}>{t('run:batchPercentHint')}</span>
              {!batchPercentValid && value.batchPercent.trim() ? (
                <span className={styles.warn}>{t('run:batchPercentError')}</span>
              ) : null}
            </label>
          )}
        </>
      ) : (
        // Window: batch_size не используется — пояснение
        <div className={styles.hint} style={{ marginTop: 4 }}>
          {t('run:batchSizeWindowHidden')}
        </div>
      )}

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
        <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>On-failure</legend>
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

      {/* fail_threshold */}
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('run:failThresholdLabel')}</span>
        <input
          type="number"
          className={styles.field}
          min={1}
          value={value.failThreshold}
          onChange={(e) => onChange({ ...value, failThreshold: e.target.value })}
          placeholder={t('run:failThresholdPlaceholder')}
          aria-label="Fail threshold"
        />
        <span className={styles.hint}>{t('run:failThresholdHint')}</span>
      </label>

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
                min={60}
                value={cadenceState.intervalSeconds}
                onChange={(e) => onCadenceChange({ ...cadenceState, intervalSeconds: e.target.value })}
                placeholder="3600"
                aria-label="Interval seconds"
                data-testid="cadence-interval"
              />
              <span className={styles.hint}>{t('run:cadenceIntervalHint')}</span>
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
