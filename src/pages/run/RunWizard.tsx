import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { Play, ArrowLeft, ArrowRight, Send, Box, Terminal } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import type {
  ErrandRunOnFailure,
  IncarnationRunRequest,
  ModuleCatalogItem,
  ModuleKind,
  ModuleParam,
  ScenarioInputSchema,
  ServiceScenarioInfo,
  SoulListEntry,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useServiceScenarios } from '../incarnations/useServiceScenarios';
import { runnableScenarios } from '../incarnations/reservedScenarios';
import { ScenarioInputFields } from '../incarnations/ScenarioInputFields';
import {
  defaultsFromSchema,
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
  // Множественный выбор incarnations для fan-out.
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
//   - core cmd/exec (params пусты, errand-safe) → cmd-textarea (как было).
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
  // shell/exec — cmd; для модулей с params не используется.
  cmd: string;
  // Типизированные значения params-формы (для модулей с params[]).
  paramFields: ScenarioFieldsState;
  timeoutSeconds: number;
  // Free-text fallback (каталог недоступен): имя модуля + динамический input.
  customModule: string;
  customInput: Record<string, unknown>;
}

// «cmd-модули» — core shell/exec: params пусты, форма = cmd-textarea.
const CMD_FIELD_MODULES = new Set(['core.cmd', 'core.exec']);

// Режим запуска scenario-workload: classic single-run / Tide (волнами, ADR-040).
// Command-workload всегда «classic» в этом смысле (Tide для него не применяется).
type RunMode = 'classic' | 'tide';

interface OptionsState {
  runMode: RunMode;
  waveSize: string;
  concurrency: string;
  onFailure: ErrandRunOnFailure;
  // Tide invocation-time target-override (опционально). Пустые → не шлём.
  targetCoven: string;
  targetWhere: string;
  dryRun: boolean;
  wait: boolean;
}

const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Черновик wizard-а в sessionStorage: переживает навигацию away/back между шагами
// и сменой workload (под-шаги пере-монтируются — без persist локальный state шага
// терялся бы). Очищается после успешного submit.
const DRAFT_KEY = 'run-wizard-draft';

interface WizardDraft {
  step: 1 | 2 | 3 | 4;
  workload: Workload;
  scenarioState: ScenarioStateValues;
  commandState: CommandStateValues;
  hostCriteria: HostCriteria;
  options: OptionsState;
}

function loadDraft(): WizardDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WizardDraft;
  } catch {
    return null;
  }
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
      ['workload', 'service', 'scenario', 'incarnation', 'module', 'cmd', 'target_coven', 'target_regex', 'target_sids'].some(
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
  const initialCmd = searchParams.get('cmd') ?? '';

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

  const [scenarioState, setScenarioState] = useState<ScenarioStateValues>(
    draft?.scenarioState ?? {
      service: initialService,
      scenario: initialScenario,
      incarnations: initialIncarnation ? [initialIncarnation] : [],
      fields: {},
      inputObj: {},
    },
  );

  const [commandState, setCommandState] = useState<CommandStateValues>(
    draft?.commandState ?? {
      ...(() => {
        const m = pickInitialCommandModule(initialModuleParam);
        return {
          moduleName: m.name,
          moduleState: m.state,
          moduleStates: m.state ? [m.state] : [],
          moduleKind: m.name.startsWith('core.') ? ('core' as const) : (initialModuleParam ? ('' as const) : ('core' as const)),
          moduleParams: [] as ModuleParam[],
        };
      })(),
      cmd: initialCmd,
      paramFields: {},
      timeoutSeconds: 30,
      customModule: '',
      customInput: {},
    },
  );

  const [hostCriteria, setHostCriteria] = useState<HostCriteria>(
    draft?.hostCriteria ?? (hasCriteriaFromQuery ? initialCriteria : EMPTY_HOST_CRITERIA),
  );

  const [options, setOptions] = useState<OptionsState>(
    draft?.options ?? {
      runMode: 'classic',
      waveSize: '',
      concurrency: '50',
      onFailure: 'abort',
      targetCoven: '',
      targetWhere: '',
      dryRun: false,
      wait: false,
    },
  );

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Persist черновика на каждое изменение wizard-state. sessionStorage —
  // переживает навигацию внутри вкладки браузера, чистится при закрытии вкладки.
  useEffect(() => {
    const payload: WizardDraft = { step, workload, scenarioState, commandState, hostCriteria, options };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage недоступен (private-mode/quota) — persist опционален, не падаем.
    }
  }, [step, workload, scenarioState, commandState, hostCriteria, options]);

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

  // Пустые required params типизированной формы (модули с params[]).
  const commandMissingRequired = useMemo(() => {
    if (workload !== 'command' || !hasParams(commandState.moduleParams)) return [];
    return missingRequiredFields(paramsToInputSchema(commandState.moduleParams), commandState.paramFields);
  }, [workload, commandState.moduleParams, commandState.paramFields]);

  const canAdvanceFromStep3 = useMemo(() => {
    if (workload === 'scenario') {
      return scenarioState.incarnations.length > 0 && scenarioMissingRequired.length === 0;
    }
    // command: Step3 — module+params.
    // Free-text fallback (каталог недоступен): нужно имя модуля.
    if (!commandState.moduleName.trim()) return false;
    // Модуль с params — все required заполнены.
    if (hasParams(commandState.moduleParams)) return commandMissingRequired.length === 0;
    // cmd-модули (core.cmd/core.exec) — нужен непустой cmd.
    if (CMD_FIELD_MODULES.has(commandState.moduleName)) return commandState.cmd.trim().length > 0;
    // Прочие модули без формализованных params (free-text fallback или core
    // без cmd-поля) — имени достаточно.
    return true;
  }, [workload, scenarioState.incarnations, scenarioMissingRequired, commandState, commandMissingRequired]);

  // --- Submit ---
  const submitMu = useMutation({
    mutationFn: async () => {
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

  function buildScenarioBody(): IncarnationRunRequest {
    const inputObj =
      usePerField && inputSchema
        ? serializeFields(inputSchema, scenarioState.fields)
        : scenarioState.inputObj;
    const body: IncarnationRunRequest = { input: inputObj };
    // Tide-режим активируется наличием `wave` в body. В classic — поле не шлём,
    // backend отвечает classic single-run reply.
    if (options.runMode === 'tide') {
      const waveSize = parseIntOrEmpty(options.waveSize);
      // Submit заблокирован, пока waveSize невалиден (canSubmit), но защищаемся.
      if (waveSize && waveSize > 0) {
        body.wave = { size: waveSize, on_failure: options.onFailure };
        const c = parseIntOrEmpty(options.concurrency);
        if (c && c > 0) body.concurrency = c;
        const target = buildTargetOverride(options.targetCoven, options.targetWhere);
        if (target) body.target = target;
      }
    }
    return body;
  }

  async function submitScenario(): Promise<string> {
    const body = buildScenarioBody();
    const names = scenarioState.incarnations;

    // Single — обычный single-вызов, redirect на результат.
    if (names.length === 1) {
      const reply = await keeperApi.incarnations.runScenario(names[0], scenarioState.scenario, body);
      if (reply.tide_id) return `/tides/${encodeURIComponent(reply.tide_id)}`;
      return `/incarnations/${encodeURIComponent(names[0])}`;
    }

    // Multi — client-side fan-out: по запросу на каждую incarnation.
    const results = await Promise.allSettled(
      names.map((name) => keeperApi.incarnations.runScenario(name, scenarioState.scenario, body)),
    );
    const launched = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - launched;
    if (launched === 0) {
      // Все упали — пробрасываем первую ошибку для отображения.
      const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw first?.reason ?? new Error('fan-out failed');
    }
    if (failed > 0) {
      setSubmitError(t('run:fanoutPartial', { launched, total: names.length }));
    }
    // Если хоть один прогон обернулся в Tide — ведём на этот Tide; иначе на incarnations list.
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.tide_id) {
        return `/tides/${encodeURIComponent(r.value.tide_id)}`;
      }
    }
    return '/incarnations';
  }

  async function submitCommand(): Promise<string> {
    const c = parseIntOrEmpty(options.concurrency);
    // Полный адрес модуля — `<name>.<state>` (state опускается, если пуст —
    // free-text fallback мог не задать его).
    const moduleName = commandState.moduleState
      ? `${commandState.moduleName}.${commandState.moduleState}`
      : commandState.moduleName;
    let input: Record<string, unknown>;
    if (hasParams(commandState.moduleParams)) {
      input = serializeFields(paramsToInputSchema(commandState.moduleParams), commandState.paramFields);
    } else if (CMD_FIELD_MODULES.has(commandState.moduleName)) {
      input = { cmd: commandState.cmd };
    } else {
      input = commandState.customInput;
    }
    // UI уже резолвил rich-criteria в явный список SID — шлём sids.
    const reply = await keeperApi.errandRuns.create({
      module: moduleName,
      input,
      timeout_seconds: commandState.timeoutSeconds > 0 ? commandState.timeoutSeconds : undefined,
      target: { sids: resolvedSids },
      concurrency: c && c > 0 ? c : 50,
      on_failure: options.onFailure,
    });
    return `/errand-runs/${encodeURIComponent(reply.errand_run_id)}`;
  }

  // В Tide-режиме (scenario) wave size обязателен и должен быть >=1.
  const tideValid = useMemo(() => {
    if (workload !== 'scenario' || options.runMode !== 'tide') return true;
    const n = parseIntOrEmpty(options.waveSize);
    return Boolean(n && n >= 1);
  }, [workload, options.runMode, options.waveSize]);

  const canSubmit = canAdvanceFromStep2 && canAdvanceFromStep3 && tideValid && !submitMu.isPending;

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

      <Stepper step={step} workload={workload} onJump={(s) => setStep(s)} />

      <div className={styles.body}>
        {step === 1 ? <Step1 value={workload} onChange={setWorkload} /> : null}

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
          />
        ) : null}
        {step === 3 && workload === 'command' ? (
          <Step3CommandParams
            value={commandState}
            onChange={setCommandState}
            missingRequired={commandMissingRequired}
          />
        ) : null}

        {step === 4 ? (
          <Step4Options value={options} onChange={setOptions} workload={workload} />
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
              <Send size={14} /> {submitMu.isPending ? t('running') : t('run')}
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
  onJump,
}: {
  step: 1 | 2 | 3 | 4;
  workload: Workload;
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
        const done = s.id < step;
        const cls = `${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`;
        return (
          <li key={s.id}>
            <button
              type="button"
              className={cls.trim()}
              onClick={() => onJump(s.id)}
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

function Step1({ value, onChange }: { value: Workload; onChange: (v: Workload) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.radioRow} role="radiogroup" aria-label="Workload type">
      {WORKLOADS.map((w) => {
        const active = value === w.kind;
        const Icon = w.icon;
        return (
          <label key={w.kind} className={`${styles.radioCard} ${active ? styles.radioCardActive : ''}`}>
            <input
              type="radio"
              name="workload"
              value={w.kind}
              checked={active}
              onChange={() => onChange(w.kind)}
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
          onChange={(e) => onChange({ ...value, service: e.target.value, scenario: '', incarnations: [] })}
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

// Step 3 Scenario: multi-select incarnations (regex-фильтр + host-count preview) +
// input-параметры сценария.
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
}: {
  value: ScenarioStateValues;
  onChange: (next: ScenarioStateValues) => void;
  incarnationsLoading: boolean;
  incarnationNames: string[];
  hostCountByIncarnation: Record<string, number> | undefined;
  usePerField: boolean;
  inputSchema: ScenarioInputSchema | undefined;
  selectedScenarioMeta: ServiceScenarioInfo | undefined;
  missingRequired: string[];
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');

  // Сидируем defaults при смене supported schema, но НЕ затираем уже введённые/
  // восстановленные из черновика значения (иначе re-mount шага сбрасывал бы input).
  useEffect(() => {
    if (usePerField && inputSchema) {
      if (Object.keys(value.fields).length === 0) {
        onChange({ ...value, fields: defaultsFromSchema(inputSchema) });
      }
    } else if (Object.keys(value.fields).length > 0) {
      onChange({ ...value, fields: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePerField, inputSchema]);

  const filterRe = useMemo(() => {
    const r = filter.trim();
    if (!r) return { re: null as RegExp | null, error: null as string | null };
    try {
      return { re: new RegExp(r), error: null };
    } catch (err) {
      return { re: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [filter]);

  const matched = useMemo(() => {
    if (!filterRe.re) return incarnationNames;
    return incarnationNames.filter((n) => filterRe.re!.test(n));
  }, [incarnationNames, filterRe.re]);

  const selected = new Set(value.incarnations);
  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange({ ...value, incarnations: Array.from(next) });
  }

  const totalHosts = useMemo(() => {
    if (!hostCountByIncarnation) return undefined;
    return value.incarnations.reduce((acc, n) => acc + (hostCountByIncarnation[n] ?? 0), 0);
  }, [hostCountByIncarnation, value.incarnations]);

  return (
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>{t('run:incarnationRegexLabel')}</span>
        <input
          type="text"
          className={styles.field}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('run:incarnationRegexPlaceholder')}
          aria-label="Incarnation regex"
        />
        {filterRe.error ? <span className={styles.warn}>{filterRe.error}</span> : null}
      </label>

      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          {t('run:incarnationSelectedOf', { selected: value.incarnations.length, total: incarnationNames.length })}
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
          role="listbox"
          aria-label="Incarnations"
        >
          {incarnationsLoading ? <div className={pageStyles.loading}>{t('loading')}</div> : null}
          {matched.map((name) => {
            const checked = selected.has(name);
            const count = hostCountByIncarnation?.[name];
            return (
              <label
                key={name}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '4px 2px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(name)} aria-label={name} />
                {name}
                <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                  {count === undefined ? t('run:hostCountUnknown') : t('run:hostCount', { count })}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className={styles.preview} aria-label="Incarnation preview">
        <div>
          {t('run:incarnationPreview', { count: value.incarnations.length })}
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
            showErrors={missingRequired.length > 0}
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
}: {
  value: CommandStateValues;
  onChange: (next: CommandStateValues) => void;
  missingRequired: string[];
}) {
  const { t } = useTranslation();
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);

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
      cmd: CMD_FIELD_MODULES.has(item.name) ? value.cmd : '',
      paramFields: hasParams(item.params) ? defaultsFromSchema(paramsToInputSchema(item.params)) : {},
    };
    onChange(next);
  }

  const showCmdFields = CMD_FIELD_MODULES.has(value.moduleName) && !hasParams(value.moduleParams);
  const showParamsForm = hasParams(value.moduleParams);
  const paramsSchema = useMemo(() => paramsToInputSchema(value.moduleParams), [value.moduleParams]);
  const isShellModule = value.moduleName === 'core.cmd';

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
          />
        </div>
      ) : showCmdFields ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>
            {isShellModule ? t('run:commandShellLabel') : t('run:commandExecLabel')}
          </span>
          <textarea
            className={styles.field}
            rows={4}
            value={value.cmd}
            onChange={(e) => onChange({ ...value, cmd: e.target.value })}
            placeholder={isShellModule ? t('run:commandShellPlaceholder') : t('run:commandExecPlaceholder')}
            aria-label="Command"
          />
        </label>
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
}: {
  value: OptionsState;
  onChange: (next: OptionsState) => void;
  workload: Workload;
}) {
  const { t } = useTranslation();
  const tideMode = workload === 'scenario' && value.runMode === 'tide';
  return (
    <>
      {workload === 'scenario' ? (
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('run:runModeLabel')}</span>
          <div className={styles.modeRow} role="radiogroup" aria-label="Run mode">
            <button
              type="button"
              className={`${styles.modeChip} ${value.runMode === 'classic' ? styles.modeChipActive : ''}`}
              aria-pressed={value.runMode === 'classic'}
              onClick={() => onChange({ ...value, runMode: 'classic' })}
              data-testid="run-mode-classic"
            >
              {t('run:runModeClassic')}
            </button>
            <button
              type="button"
              className={`${styles.modeChip} ${value.runMode === 'tide' ? styles.modeChipActive : ''}`}
              aria-pressed={value.runMode === 'tide'}
              onClick={() => onChange({ ...value, runMode: 'tide' })}
              data-testid="run-mode-tide"
            >
              {t('run:runModeTide')}
            </button>
          </div>
          <span className={styles.hint}>
            {tideMode ? t('run:runModeTideHint') : t('run:runModeClassicHint')}
          </span>
        </div>
      ) : null}

      {tideMode ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('run:waveSizeLabel')}</span>
          <input
            type="number"
            className={styles.field}
            min={1}
            value={value.waveSize}
            onChange={(e) => onChange({ ...value, waveSize: e.target.value })}
            placeholder={t('run:waveSizePlaceholder')}
            aria-label="Wave size"
          />
        </label>
      ) : null}
      {workload === 'command' || tideMode ? (
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
        </label>
      ) : null}

      {tideMode ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>
            {t('run:targetOverrideSummary')}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', marginTop: 10 }}>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:targetCovenLabel')}</span>
              <input
                type="text"
                className={styles.field}
                value={value.targetCoven}
                onChange={(e) => onChange({ ...value, targetCoven: e.target.value })}
                placeholder={t('run:targetCovenPlaceholder')}
                aria-label="Target coven override"
              />
            </label>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:targetWhereLabel')}</span>
              <input
                type="text"
                className={styles.field}
                value={value.targetWhere}
                onChange={(e) => onChange({ ...value, targetWhere: e.target.value })}
                placeholder={t('run:targetWherePlaceholder')}
                aria-label="Target where override"
              />
            </label>
            <span className={styles.hint}>{t('run:targetOverrideHint')}</span>
          </div>
        </details>
      ) : null}
      {workload === 'command' || tideMode ? (
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
      ) : null}
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

// Сборка опционального invocation-time target-override (Tide). coven — CSV →
// массив kebab-меток; where — raw CEL-строка. Возвращает undefined, если оба
// пусты (override не задан). AND-merge со scenario on:/where: — на backend.
function buildTargetOverride(
  covenCsv: string,
  where: string,
): NonNullable<IncarnationRunRequest['target']> | undefined {
  const coven = splitCsv(covenCsv);
  const w = where.trim();
  if (coven.length === 0 && !w) return undefined;
  const target: NonNullable<IncarnationRunRequest['target']> = {};
  if (coven.length > 0) target.coven = coven;
  if (w) target.where = w;
  return target;
}

function parseIntOrEmpty(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? undefined : n;
}
