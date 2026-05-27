import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, ArrowLeft, ArrowRight, Send, Box, Terminal, Upload } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import type {
  ErrandRunOnFailure,
  IncarnationRunRequest,
  ScenarioInputSchema,
  ServiceScenarioInfo,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { ChipsInput } from '../incarnations/ChipsInput';
import { useServiceScenarios } from '../incarnations/useServiceScenarios';
import { ScenarioInputFields } from '../incarnations/ScenarioInputFields';
import {
  defaultsFromSchema,
  isSupportedInputSchema,
  serializeFields,
  type ScenarioFieldsState,
} from '../incarnations/scenarioInputFields.helpers';
import {
  EMPTY_TARGET_SPEC,
  describeTarget,
  hasAnyTarget,
  queryHasTargetParams,
  specFromQueryParams,
  translateTarget,
  type TargetMode,
  type TargetSpec,
} from './targetTranslator';
import { DynamicInputBuilder } from '../../components/input/DynamicInputBuilder';
import pageStyles from '../common.module.css';
import styles from './WizardSteps.module.css';

// Workload-тип Step 1.
type Workload = 'scenario' | 'command' | 'push';

// Stepper-определение.
const STEPS: Array<{ id: 1 | 2 | 3 | 4; label: string }> = [
  { id: 1, label: 'Workload' },
  { id: 2, label: 'Params' },
  { id: 3, label: 'Target' },
  { id: 4, label: 'Options' },
];

// Step 1 — выбор workload.
const WORKLOADS: Array<{ kind: Workload; title: string; desc: string; icon: typeof Box }> = [
  { kind: 'scenario', title: 'Scenario apply', desc: 'Apply scenario из service на incarnation (pull-режим).', icon: Box },
  { kind: 'command', title: 'Command', desc: 'Ad-hoc exec на нескольких Souls через Errand multi-target.', icon: Terminal },
  { kind: 'push', title: 'Push destiny', desc: 'Push destiny по SSH без агента.', icon: Upload },
];

interface ScenarioStateValues {
  service: string;
  scenario: string;
  incarnation: string;
  incarnationMode: 'existing' | 'create';
  newIncarnationName: string;
  newIncarnationCovens: string[];
  fields: ScenarioFieldsState;
  // Используется только когда scenario без typed input_schema — DynamicInputBuilder.
  inputObj: Record<string, unknown>;
}

// Module — кортеж known core-модулей + произвольный custom.
type CommandModuleKind = 'core.cmd.shell' | 'core.exec.run' | 'custom';

interface CommandStateValues {
  moduleKind: CommandModuleKind;
  // Для CommandModuleKind === 'custom' — имя custom-модуля.
  customModule: string;
  // shell/exec — cmd; для custom не используется.
  cmd: string;
  timeoutSeconds: number;
  // Для CommandModuleKind === 'custom' — динамический input-объект.
  customInput: Record<string, unknown>;
}

interface PushStateValues {
  destiny: string;
  sshProvider: string;
  inputObj: Record<string, unknown>;
}

interface OptionsState {
  waveSize: string;
  concurrency: string;
  onFailure: ErrandRunOnFailure;
  dryRun: boolean;
  wait: boolean;
}

const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Pre-fill из query-string: /run?workload=scenario&service=<svc>&incarnation=<name>.
// Используется при переходе с IncarnationDetail (Run Scenario button) и при
// прямых ссылках из ErrandsList/PushApply (deprecated entry-points).
// Дополнительные query-keys (bulk-run actions со списочных страниц):
//   target_sids / target_coven / target_glob / target_regex / target_where
//   scenario / module / cmd
// см. specFromQueryParams / queryHasTargetParams в targetTranslator.ts.
function pickWorkloadFromQuery(raw: string | null): Workload {
  if (raw === 'command' || raw === 'push' || raw === 'scenario') return raw;
  return 'scenario';
}

function pickInitialCommandModule(raw: string | null): CommandModuleKind {
  if (raw === 'core.exec.run') return 'core.exec.run';
  if (raw === 'core.cmd.shell' || raw === null) return 'core.cmd.shell';
  return 'custom';
}

export function RunWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialWorkload = pickWorkloadFromQuery(searchParams.get('workload'));
  const initialService = searchParams.get('service') ?? '';
  const initialIncarnation = searchParams.get('incarnation') ?? '';
  const initialScenario = searchParams.get('scenario') ?? '';
  const initialModuleParam = searchParams.get('module');
  const initialCmd = searchParams.get('cmd') ?? '';

  // Pre-fill target из query — bulk-run actions с list-страниц передают сюда
  // через ?target_sids / ?target_coven / ?target_glob / ?target_regex / ?target_where.
  const initialTargetSpec = useMemo<TargetSpec>(
    () => specFromQueryParams(searchParams),
    // searchParams читаем один раз на mount; никакого remount при изменении.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const hasTargetFromQuery = useMemo(
    () => queryHasTargetParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Если в URL уже всё нужное для Step 2 — открываем Wizard сразу на Step 3.
  const initialStep = useMemo<1 | 2 | 3 | 4>(() => {
    if (!hasTargetFromQuery) return 1;
    if (initialWorkload === 'command' && initialCmd.trim().length > 0) return 3;
    if (initialWorkload === 'scenario' && initialService && initialScenario && initialIncarnation) return 3;
    return 1;
  }, [hasTargetFromQuery, initialWorkload, initialCmd, initialService, initialScenario, initialIncarnation]);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep);
  const [workload, setWorkload] = useState<Workload>(initialWorkload);

  const [scenarioState, setScenarioState] = useState<ScenarioStateValues>({
    service: initialService,
    scenario: initialScenario,
    incarnation: initialIncarnation,
    incarnationMode: 'existing',
    newIncarnationName: '',
    newIncarnationCovens: [],
    fields: {},
    inputObj: {},
  });

  const [commandState, setCommandState] = useState<CommandStateValues>({
    moduleKind: pickInitialCommandModule(initialModuleParam),
    customModule:
      initialModuleParam && initialModuleParam !== 'core.cmd.shell' && initialModuleParam !== 'core.exec.run'
        ? initialModuleParam
        : '',
    cmd: initialCmd,
    timeoutSeconds: 30,
    customInput: {},
  });

  const [pushState, setPushState] = useState<PushStateValues>({
    destiny: '',
    sshProvider: '',
    inputObj: {},
  });

  const [targetSpec, setTargetSpec] = useState<TargetSpec>(
    hasTargetFromQuery ? initialTargetSpec : EMPTY_TARGET_SPEC,
  );

  const [options, setOptions] = useState<OptionsState>({
    waveSize: '',
    concurrency: '50',
    onFailure: 'abort',
    dryRun: false,
    wait: false,
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  function goNext() {
    setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s));
  }
  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s));
  }

  // Step 2 валидируется по типу workload.
  const canAdvanceFromStep2 = useMemo(() => {
    if (workload === 'scenario') {
      if (!scenarioState.service || !scenarioState.scenario) return false;
      if (scenarioState.incarnationMode === 'existing') return Boolean(scenarioState.incarnation);
      return NAME_REGEX.test(scenarioState.newIncarnationName);
    }
    if (workload === 'command') {
      if (commandState.moduleKind === 'custom') {
        return commandState.customModule.trim().length > 0;
      }
      return commandState.cmd.trim().length > 0;
    }
    // push
    return pushState.destiny.trim().length > 0;
  }, [workload, scenarioState, commandState, pushState]);

  // Step 3: target обязателен для command (multi-target Errand). Для scenario без wave
  // target опционален (берётся из scenario `on:/where:`), для push — inventory_sids
  // мы достаём из SIDs-режима в Step 3, поэтому SIDs обязателен.
  const canAdvanceFromStep3 = useMemo(() => {
    if (workload === 'command') return hasAnyTarget(targetSpec);
    if (workload === 'push') {
      // Push требует именно inventory SID-ов (SSH).
      return targetSpec.modes.has('sids') && targetSpec.sids.length > 0;
    }
    return true; // scenario apply без override-а — допустим.
  }, [workload, targetSpec]);

  // --- Submit ---
  const submitMu = useMutation({
    mutationFn: async () => {
      if (workload === 'scenario') return submitScenario();
      if (workload === 'command') return submitCommand();
      return submitPush();
    },
    onError: (err) => {
      setSubmitError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
    },
    onSuccess: (redirect) => {
      navigate(redirect);
    },
  });

  // Текущий scenario.input_schema (для serialize в API).
  const scenariosQ = useServiceScenarios(workload === 'scenario' ? scenarioState.service || undefined : undefined);
  const selectedScenarioMeta = useMemo<ServiceScenarioInfo | undefined>(
    () => scenariosQ.items.find((s) => s.name === scenarioState.scenario),
    [scenariosQ.items, scenarioState.scenario],
  );
  const inputSchema: ScenarioInputSchema | undefined = selectedScenarioMeta?.input_schema;
  const usePerField = isSupportedInputSchema(inputSchema);

  async function submitScenario(): Promise<string> {
    const incarnationName =
      scenarioState.incarnationMode === 'existing'
        ? scenarioState.incarnation
        : scenarioState.newIncarnationName;

    const inputObj =
      usePerField && inputSchema
        ? serializeFields(inputSchema, scenarioState.fields)
        : scenarioState.inputObj;

    // Create new incarnation (если выбрано) — отдельный POST до runScenario.
    if (scenarioState.incarnationMode === 'create') {
      await keeperApi.incarnations.create({
        name: scenarioState.newIncarnationName,
        service: scenarioState.service,
        covens: scenarioState.newIncarnationCovens,
        input: inputObj,
      });
      // Для свежесозданной incarnation `create` уже отработал — следующий
      // scenario apply делаем отдельно ниже только если оператор хочет другой
      // сценарий (т.е. отличается от `create`). Если scenario === 'create',
      // нечего делать второй раз.
      if (scenarioState.scenario === 'create') {
        return `/incarnations/${encodeURIComponent(incarnationName)}`;
      }
    }

    const body: IncarnationRunRequest = { input: inputObj };
    const waveSize = parseIntOrEmpty(options.waveSize);
    if (waveSize && waveSize > 0) {
      body.wave = { size: waveSize, on_failure: options.onFailure };
      // Tide invocation-time target-override (AND-merge поверх scenario).
      const tr = translateTarget(targetSpec);
      if (tr.target.coven && tr.target.coven.length > 0) {
        body.target = { ...(body.target ?? {}), coven: tr.target.coven };
      }
      if (tr.target.where) {
        body.target = { ...(body.target ?? {}), where: tr.target.where };
      }
      // SIDs в Tide-target API нет (sids — только Errand). Деградируем в where:
      // sid in [..], если оператор задал SIDs.
      if (tr.target.sids && tr.target.sids.length > 0) {
        const sidList = tr.target.sids.map((s) => `"${s}"`).join(', ');
        const sidPred = `sid in [${sidList}]`;
        body.target = {
          ...(body.target ?? {}),
          where: body.target?.where ? `(${body.target.where}) && (${sidPred})` : sidPred,
        };
      }
      const c = parseIntOrEmpty(options.concurrency);
      if (c && c > 0) body.concurrency = c;
    }

    const reply = await keeperApi.incarnations.runScenario(
      incarnationName,
      scenarioState.scenario,
      body,
    );

    if (reply.tide_id) {
      return `/tides/${encodeURIComponent(reply.tide_id)}`;
    }
    // Classic apply — нет dedicated apply-runs page, redirect на incarnation.
    return `/incarnations/${encodeURIComponent(incarnationName)}`;
  }

  async function submitCommand(): Promise<string> {
    const tr = translateTarget(targetSpec);
    const c = parseIntOrEmpty(options.concurrency);
    const moduleName =
      commandState.moduleKind === 'custom' ? commandState.customModule : commandState.moduleKind;
    const input =
      commandState.moduleKind === 'custom' ? commandState.customInput : { cmd: commandState.cmd };
    const reply = await keeperApi.errandRuns.create({
      module: moduleName,
      input,
      timeout_seconds: commandState.timeoutSeconds > 0 ? commandState.timeoutSeconds : undefined,
      target: tr.target,
      concurrency: c && c > 0 ? c : 50,
      on_failure: options.onFailure,
    });
    return `/errand-runs/${encodeURIComponent(reply.errand_run_id)}`;
  }

  async function submitPush(): Promise<string> {
    const tr = translateTarget(targetSpec);
    const reply = await keeperApi.push.apply({
      inventory: tr.target.sids ?? [],
      destiny: pushState.destiny,
      input: pushState.inputObj,
      ssh_provider: pushState.sshProvider || undefined,
      cleanup_stale_versions: false,
    });
    return `/push-runs/${encodeURIComponent(reply.apply_id)}`;
  }

  const canSubmit = canAdvanceFromStep2 && canAdvanceFromStep3 && !submitMu.isPending;

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>
            <Play size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Run
          </h1>
          <div className={pageStyles.crumbs}>unified entry-point: scenario / command / push</div>
        </div>
      </div>

      <Stepper step={step} onJump={(s) => setStep(s)} />

      <div className={styles.body}>
        {step === 1 ? <Step1 value={workload} onChange={setWorkload} /> : null}
        {step === 2 && workload === 'scenario' ? (
          <Step2Scenario
            value={scenarioState}
            onChange={setScenarioState}
            scenariosQ={scenariosQ}
            usePerField={usePerField}
            inputSchema={inputSchema}
            selectedScenarioMeta={selectedScenarioMeta}
          />
        ) : null}
        {step === 2 && workload === 'command' ? (
          <Step2Command value={commandState} onChange={setCommandState} />
        ) : null}
        {step === 2 && workload === 'push' ? (
          <Step2Push value={pushState} onChange={setPushState} />
        ) : null}
        {step === 3 ? <Step3Target value={targetSpec} onChange={setTargetSpec} /> : null}
        {step === 4 ? (
          <Step4Options value={options} onChange={setOptions} workload={workload} />
        ) : null}

        {submitError ? <div className={pageStyles.errorBox}>{submitError}</div> : null}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={goBack} disabled={step === 1}>
            <ArrowLeft size={14} /> Назад
          </Button>
          {step < 4 ? (
            <Button
              type="button"
              variant="primary"
              onClick={goNext}
              disabled={
                (step === 2 && !canAdvanceFromStep2) ||
                (step === 3 && !canAdvanceFromStep3)
              }
            >
              Далее <ArrowRight size={14} />
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
              <Send size={14} /> {submitMu.isPending ? 'Запускаем…' : 'Запустить'}
            </Button>
          )}
        </div>
      </div>

    </div>
  );
}

function Stepper({ step, onJump }: { step: 1 | 2 | 3 | 4; onJump: (s: 1 | 2 | 3 | 4) => void }) {
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
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Step1({ value, onChange }: { value: Workload; onChange: (v: Workload) => void }) {
  return (
    <div className={styles.radioRow} role="radiogroup" aria-label="Workload type">
      {WORKLOADS.map((w) => {
        const active = value === w.kind;
        const Icon = w.icon;
        return (
          <label
            key={w.kind}
            className={`${styles.radioCard} ${active ? styles.radioCardActive : ''}`}
          >
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
              <div className={styles.radioDesc}>{w.desc}</div>
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

function Step2Scenario({
  value,
  onChange,
  scenariosQ,
  usePerField,
  inputSchema,
  selectedScenarioMeta,
}: {
  value: ScenarioStateValues;
  onChange: (next: ScenarioStateValues) => void;
  scenariosQ: ScenariosQueryResultMin;
  usePerField: boolean;
  inputSchema: ScenarioInputSchema | undefined;
  selectedScenarioMeta: ServiceScenarioInfo | undefined;
}) {
  const servicesQ = useQuery({
    queryKey: ['run.services.list'],
    queryFn: () => keeperApi.services.list(),
  });
  const incarnationsQ = useQuery({
    queryKey: ['run.incarnations.list', value.service],
    queryFn: () => keeperApi.incarnations.list({ service: value.service }),
    enabled: Boolean(value.service),
  });

  // Перезаливаем fields-state при смене scenario с supported schema.
  useEffect(() => {
    if (usePerField && inputSchema) {
      onChange({ ...value, fields: defaultsFromSchema(inputSchema) });
    } else if (Object.keys(value.fields).length > 0) {
      onChange({ ...value, fields: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.scenario, usePerField, inputSchema]);

  return (
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Service</span>
        <select
          className={styles.field}
          value={value.service}
          onChange={(e) => onChange({ ...value, service: e.target.value, scenario: '', incarnation: '' })}
        >
          <option value="">— выберите сервис —</option>
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
            <option value="">— выберите scenario —</option>
            {scenariosQ.items.map((s) => (
              <option key={s.name} value={s.name} title={s.description ?? ''}>
                {s.name}
                {s.description ? ` — ${s.description}` : ''}
              </option>
            ))}
          </select>
          {scenariosQ.unavailable ? (
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              scenario-каталог не предоставлен сервером — dynamic input form fallback.
            </span>
          ) : null}
        </label>
      ) : null}

      {value.service && value.scenario ? (
        <>
          <fieldset
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
          >
            <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
              Incarnation
            </legend>
            <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="incarnationMode"
                  value="existing"
                  checked={value.incarnationMode === 'existing'}
                  onChange={() => onChange({ ...value, incarnationMode: 'existing' })}
                />
                Existing
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="incarnationMode"
                  value="create"
                  checked={value.incarnationMode === 'create'}
                  onChange={() => onChange({ ...value, incarnationMode: 'create' })}
                />
                Create new
              </label>
            </div>
            {value.incarnationMode === 'existing' ? (
              <label className={styles.fieldRow}>
                <span className={styles.fieldLabel}>Existing incarnation (filter by service)</span>
                <select
                  className={styles.field}
                  value={value.incarnation}
                  onChange={(e) => onChange({ ...value, incarnation: e.target.value })}
                  disabled={incarnationsQ.isLoading}
                >
                  <option value="">— выберите incarnation —</option>
                  {(incarnationsQ.data?.items ?? []).map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} [{i.status}]
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>New incarnation name (kebab-case)</span>
                  <input
                    type="text"
                    className={styles.field}
                    value={value.newIncarnationName}
                    onChange={(e) => onChange({ ...value, newIncarnationName: e.target.value })}
                    placeholder="redis-prod"
                  />
                </label>
                <div>
                  <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
                    Covens (declared environment-теги)
                  </div>
                  <ChipsInput
                    value={value.newIncarnationCovens}
                    onChange={(next) => onChange({ ...value, newIncarnationCovens: next })}
                    placeholder="prod, datacenter-1"
                    ariaLabel="Covens"
                    validate={(t) => (NAME_REGEX.test(t) ? null : 'kebab-case: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$')}
                  />
                </div>
              </div>
            )}
          </fieldset>

          {usePerField && inputSchema ? (
            <div>
              <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
                Input (поля scenario <code className="mono">{value.scenario}</code>)
              </div>
              <ScenarioInputFields
                schema={inputSchema}
                value={value.fields}
                onChange={(next) => onChange({ ...value, fields: next })}
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
                Input (динамический form-builder без input_schema)
              </div>
              <DynamicInputBuilder
                value={value.inputObj}
                onChange={(next) => onChange({ ...value, inputObj: next })}
                ariaLabel="Scenario input fields"
              />
            </div>
          )}
        </>
      ) : null}
    </>
  );
}

function Step2Command({
  value,
  onChange,
}: {
  value: CommandStateValues;
  onChange: (next: CommandStateValues) => void;
}) {
  const isCustom = value.moduleKind === 'custom';
  return (
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Module</span>
        <select
          className={styles.field}
          value={value.moduleKind}
          onChange={(e) =>
            onChange({ ...value, moduleKind: e.target.value as CommandStateValues['moduleKind'] })
          }
          aria-label="Module"
        >
          <option value="core.cmd.shell">core.cmd.shell</option>
          <option value="core.exec.run">core.exec.run</option>
          <option value="custom">— custom module —</option>
        </select>
      </label>
      {isCustom ? (
        <>
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Module name</span>
            <input
              type="text"
              className={styles.field}
              value={value.customModule}
              onChange={(e) => onChange({ ...value, customModule: e.target.value })}
              placeholder="core.http.probe"
              aria-label="Custom module name"
            />
          </label>
          <div>
            <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
              Input
            </div>
            <DynamicInputBuilder
              value={value.customInput}
              onChange={(next) => onChange({ ...value, customInput: next })}
              ariaLabel="Custom module input fields"
            />
          </div>
        </>
      ) : (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>
            {value.moduleKind === 'core.cmd.shell' ? 'Command (sh -c)' : 'Binary + args (одной строкой)'}
          </span>
          <textarea
            className={styles.field}
            rows={4}
            value={value.cmd}
            onChange={(e) => onChange({ ...value, cmd: e.target.value })}
            placeholder={value.moduleKind === 'core.cmd.shell' ? 'uptime && df -h' : '/usr/bin/uptime'}
            aria-label="Command"
          />
        </label>
      )}
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Timeout (s)</span>
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

function Step2Push({
  value,
  onChange,
}: {
  value: PushStateValues;
  onChange: (next: PushStateValues) => void;
}) {
  const providersQ = useQuery({
    queryKey: ['run.pushProviders.list'],
    queryFn: () => keeperApi.pushProviders.list(),
    retry: false,
  });
  const providers = providersQ.data?.items ?? [];

  return (
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Destiny ref (&lt;name&gt;@&lt;ref&gt;)</span>
        <input
          type="text"
          className={styles.field}
          value={value.destiny}
          onChange={(e) => onChange({ ...value, destiny: e.target.value })}
          placeholder="redis-cluster@v2.0.0"
          aria-label="Destiny ref"
        />
      </label>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>SSH provider</span>
        {providers.length > 0 ? (
          <select
            className={styles.field}
            value={value.sshProvider}
            onChange={(e) => onChange({ ...value, sshProvider: e.target.value })}
            aria-label="SSH provider"
          >
            <option value="">— routing (первый зарегистрированный) —</option>
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className={styles.field}
            value={value.sshProvider}
            onChange={(e) => onChange({ ...value, sshProvider: e.target.value })}
            placeholder="default"
            aria-label="SSH provider name"
          />
        )}
      </label>
      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          Input
        </div>
        <DynamicInputBuilder
          value={value.inputObj}
          onChange={(next) => onChange({ ...value, inputObj: next })}
          ariaLabel="Push input fields"
        />
      </div>
    </>
  );
}

function Step3Target({
  value,
  onChange,
}: {
  value: TargetSpec;
  onChange: (next: TargetSpec) => void;
}) {
  function toggleMode(m: TargetMode) {
    const modes = new Set(value.modes);
    if (modes.has(m)) modes.delete(m);
    else modes.add(m);
    onChange({ ...value, modes });
  }

  const tr = translateTarget(value);
  const desc = describeTarget(value);

  // Live-preview counter — запрашиваем /v1/souls с coven-фильтром, считаем total.
  // glob/regex/cel_where на этом эндпоинте не разрезолвятся серверно, поэтому
  // counter максимально честно сообщает «при текущем coven-фильтре N souls».
  const covenList = value.modes.has('coven') ? value.coven : undefined;
  const previewQ = useQuery({
    queryKey: ['run.target.preview', covenList ?? null],
    queryFn: () => keeperApi.souls.list({ coven: covenList, limit: 1 }),
    enabled: Boolean(covenList && covenList.length > 0),
  });
  const previewTotal = previewQ.data?.total;

  return (
    <>
      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          Режимы (можно несколько — AND-merge)
        </div>
        <div className={styles.modeRow} role="group" aria-label="Target modes">
          {(['sids', 'coven', 'glob', 'regex', 'cel_where'] as TargetMode[]).map((m) => {
            const active = value.modes.has(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={active}
                className={`${styles.modeChip} ${active ? styles.modeChipActive : ''}`}
                onClick={() => toggleMode(m)}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      {value.modes.has('sids') ? <SidsField value={value} onChange={onChange} /> : null}

      {value.modes.has('coven') ? (
        <div>
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
            Coven labels
          </div>
          <ChipsInput
            value={value.coven}
            onChange={(next) => onChange({ ...value, coven: next })}
            placeholder="prod, datacenter-1"
            ariaLabel="Coven labels"
            validate={(t) => (NAME_REGEX.test(t) ? null : 'kebab-case')}
          />
        </div>
      ) : null}

      {value.modes.has('glob') ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Glob (FQDN-маска → sid.glob)</span>
          <input
            type="text"
            className={styles.field}
            value={value.glob}
            onChange={(e) => onChange({ ...value, glob: e.target.value })}
            placeholder="prod-*"
            aria-label="Glob pattern"
          />
        </label>
      ) : null}

      {value.modes.has('regex') ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Regex (RE2 → sid.matches)</span>
          <input
            type="text"
            className={styles.field}
            value={value.regex}
            onChange={(e) => onChange({ ...value, regex: e.target.value })}
            placeholder="^db-[0-9]+$"
            aria-label="Regex pattern"
          />
        </label>
      ) : null}

      {value.modes.has('cel_where') ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>CEL where (raw)</span>
          <textarea
            className={styles.field}
            rows={3}
            value={value.celWhere}
            onChange={(e) => onChange({ ...value, celWhere: e.target.value })}
            placeholder='soulprint.self.os.family == "debian"'
            aria-label="CEL where"
          />
        </label>
      ) : null}

      <div className={styles.preview} aria-label="Target preview">
        <div>{desc}</div>
        {tr.target.where ? (
          <div style={{ marginTop: 4 }}>
            <span style={{ color: 'var(--text-faint)' }}>where:</span> {tr.target.where}
          </div>
        ) : null}
        {previewTotal !== undefined ? (
          <div style={{ marginTop: 4 }}>
            <Badge tone="info">
              {previewTotal} souls match coven-фильтр
            </Badge>
          </div>
        ) : null}
        {tr.warnings.length > 0 ? (
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            {tr.warnings.map((w, i) => (
              <li key={i} className={styles.warn}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

function SidsField({ value, onChange }: { value: TargetSpec; onChange: (n: TargetSpec) => void }) {
  const soulsQ = useQuery({
    queryKey: ['run.target.souls.list'],
    queryFn: () => keeperApi.souls.list({ limit: 500 }),
  });
  const all = soulsQ.data?.items ?? [];
  const selected = new Set(value.sids);

  function toggle(sid: string) {
    const next = new Set(selected);
    if (next.has(sid)) next.delete(sid);
    else next.add(sid);
    onChange({ ...value, sids: Array.from(next) });
  }

  return (
    <div>
      <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
        SIDs ({value.sids.length} selected of {all.length})
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
        aria-label="SIDs"
      >
        {soulsQ.isLoading ? <div className={pageStyles.loading}>Загружаем…</div> : null}
        {all.map((s) => {
          const checked = selected.has(s.sid);
          return (
            <label
              key={s.sid}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '4px 2px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(s.sid)}
                aria-label={s.sid}
              />
              {s.sid}
              {s.coven && s.coven.length > 0 ? (
                <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                  [{s.coven.join(',')}]
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
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
  return (
    <>
      {workload === 'scenario' ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Wave size (опционально, активирует Tide)</span>
          <input
            type="number"
            className={styles.field}
            min={1}
            value={value.waveSize}
            onChange={(e) => onChange({ ...value, waveSize: e.target.value })}
            placeholder="например 10"
            aria-label="Wave size"
          />
        </label>
      ) : null}
      {workload === 'command' || (workload === 'scenario' && value.waveSize) ? (
        <label className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Concurrency</span>
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
      <fieldset
        style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
      >
        <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
          On-failure
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
      {workload === 'scenario' ? (
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={value.dryRun}
            onChange={(e) => onChange({ ...value, dryRun: e.target.checked })}
            aria-label="dry_run"
          />
          Dry-run
        </label>
      ) : null}
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={value.wait}
          onChange={(e) => onChange({ ...value, wait: e.target.checked })}
          aria-label="wait"
        />
        Ждать терминала (polling на detail-странице)
      </label>
    </>
  );
}

// --- helpers ---

function parseIntOrEmpty(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? undefined : n;
}
