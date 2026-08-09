import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { Play, ArrowLeft, ArrowRight, Send, Box, Terminal, SquareTerminal, CalendarClock, Info } from 'lucide-react';
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
import { splitScenarioNote } from './scenarioNote';
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
  SOULPRINT_FANOUT_LIMIT,
  activeExclusions,
  applyExclusions,
  compileSidRegex,
  deniedHostFromDetail,
  previewTargetKeyForSids,
  sidsFromPreviewKey,
  visibleHostRows,
  hasAnyCriteria,
  matchSoulprint,
  matchStableCriteria,
  needsSoulprint,
  parseCriteriaSoulprint,
  type HostCriteria,
} from './hostSelector';
import {
  useIncarnationMembers,
  useIncarnationRosterSizes,
  totalRosterSize,
  ROSTER_SIZE_FANOUT_LIMIT,
  type MembershipFailure,
  type UnresolvedIncarnation,
} from './useIncarnationMembers';
import { DynamicInputBuilder } from '../../components/input/DynamicInputBuilder';
import { consoleHrefFrom } from '../console/consoleLink';
import { ModulePicker } from './ModulePicker';
import { hasParams, paramsToInputSchema } from './moduleParams.helpers';
import { ChipsInput } from '../incarnations/ChipsInput';
import { NotifyBlock } from './NotifyBlock';
import { serializeNotify } from './notifyHelpers';
import pageStyles from '../common.module.css';
import styles from './WizardSteps.module.css';

// Workload type for Step 1. Push was removed — it became the internal transport of unified-Run,
// no longer a user-facing type (route /push remains deprecated).
type Workload = 'scenario' | 'command';

// Run mode: one-time Voyage or recurring Cadence.
type RunMode = 'voyage' | 'cadence';

// Stepper definition. Step 2/3 semantics differ by workload:
//   Scenario: Step2=select scenario, Step3=incarnations, Step4=input+options.
//   Command:  Step2=select hosts, Step3=module+params, Step4=options.
const STEPS: Array<{ id: 1 | 2 | 3 | 4; label: string }> = [
  { id: 1, label: 'Workload' },
  { id: 2, label: 'Select' },
  { id: 3, label: 'Configure' },
  { id: 4, label: 'Options' },
];

// Multi-console is offered next to the two wizard workloads but is not one: an
// interactive PTY wall has nothing to submit, so picking it leaves the wizard
// for the full-screen page instead of advancing to Step 2.
type WorkloadChoice = Workload | 'console';

// Step 1 — workload selection. `title` is the workload entity name (English, not translated);
// `descKey` is the i18n key for the description (translated).
const WORKLOADS: Array<{ kind: WorkloadChoice; title: string; descKey: string; icon: typeof Box }> = [
  { kind: 'scenario', title: 'Scenario apply', descKey: 'run:workloadScenarioDesc', icon: Box },
  { kind: 'command', title: 'Command', descKey: 'run:workloadCommandDesc', icon: Terminal },
  { kind: 'console', title: 'Multi-console', descKey: 'run:workloadConsoleDesc', icon: SquareTerminal },
];


interface ScenarioStateValues {
  service: string;
  scenario: string;
  // Regex over incarnation name — the source of truth for the fan-out set. The list
  // of matches is shown read-only; the scenario runs on ALL matches.
  incarnationRegex: string;
  // The set of names derived from incarnationRegex (resolved in Step3 once the
  // incarnations list is loaded). Stored in state so submit and validation
  // don't depend on the step being mounted.
  incarnations: string[];
  fields: ScenarioFieldsState;
  // Used only when the scenario has no typed input_schema — DynamicInputBuilder.
  inputObj: Record<string, unknown>;
}

// The Command module is picked from the catalog (GET /v1/modules) via ModulePicker.
// `moduleName` is the name without the state suffix (`core.cmd`); `moduleState` is the
// selected state (`shell`); the full address for submit is `<moduleName>.<moduleState>`.
//
// Params-form branching:
//   - a module with params[] -> typed per-field form (ScenarioInputFields).
//   - catalog unavailable (404/501) -> free-text name + DynamicInputBuilder.
interface CommandStateValues {
  // Name of the selected module (without the state suffix), e.g. `core.cmd`. Empty — not selected.
  moduleName: string;
  // Selected module state (`shell`/`run`/...). Full address — `moduleName.moduleState`.
  moduleState: string;
  // Valid state suffixes of the selected module (for the dropdown when >1).
  moduleStates: string[];
  // core | plugin (from the catalog). '' while nothing is selected.
  moduleKind: ModuleKind | '';
  // Module params from the catalog (for the auto-form; empty for core).
  moduleParams: ModuleParam[];
  // Typed values of the params form (for modules with params[]).
  paramFields: ScenarioFieldsState;
  timeoutSeconds: number;
  // Free-text fallback (catalog unavailable): module name + dynamic input.
  customModule: string;
  customInput: Record<string, unknown>;
}

// The batch_mode enum type is taken from types.gen via VoyageCreateRequest — no hardcoded strings.
type VoyageBatchMode = NonNullable<import('../../api/types.gen').components['schemas']['VoyageCreateRequest']['batch_mode']>;

interface OptionsState {
  // New unified string batch field (N | N%). Keeper parses it, the UI does not.
  batch: string;
  // Failure threshold: N | N%. Keeper parses it. Empty = behavior follows on_failure.
  maxFailures: string;
  concurrency: string;
  // VoyageOnFailure = 'abort' | 'continue' (superset of ErrandRunOnFailure).
  onFailure: VoyageOnFailure;
  dryRun: boolean;
  wait: boolean;
  // Delayed start (ISO-8601). Empty -> immediate start.
  scheduleAt: string;
  // Batching mode (ADR-043). barrier = sequential Legs (default); window = sliding window.
  batchMode: VoyageBatchMode;
  // Pause between Legs in ms (barrier). Empty = no pause.
  interBatchIntervalMs: string;
  // Pause between window units in ms (window). Empty = no pause.
  interUnitIntervalMs: string;
  // Presence filter: live hosts only. Applies to kind=command.
  requireAlive: boolean;
}

const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Light UX validation of the batch format: N or N% (authority is backend 422).
const BATCH_FORMAT_RE = /^\d+%?$/;

// Cadence-specific state (used only when runMode='cadence').
interface CadenceState {
  cadenceName: string;
  scheduleKind: CadenceScheduleKind;
  intervalSeconds: string;
  cronExpr: string;
  overlapPolicy: CadenceOverlapPolicy;
}

// Wizard draft in sessionStorage: survives navigation away/back between steps
// and workload changes (sub-steps are remounted — without persistence the local step
// state would be lost). Cleared after a successful submit.
const DRAFT_KEY = 'run-wizard-draft';

// Draft schema version. Bump it on any change to the sub-state shapes
// (new field, type change). loadDraft() discards drafts with a different/missing
// version — old persisted state from a previous wizard form shape is ignored, the wizard
// starts from defaults instead of crashing on a missing field.
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

// Defaults for sub-states. Used as the base for a default-merge when restoring
// a draft and as the initial state when there's no query-intent/draft. Any
// field missing from the loaded draft is taken from here (a second line of
// defense against form desync, independent of versioning).
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
    // Version mismatch (or missing on a draft from an old form shape) -> ignore.
    if (!parsed || parsed.v !== DRAFT_VERSION) return null;
    return parsed as WizardDraft;
  } catch {
    return null;
  }
}

// Guarantees an array: if the draft has a non-array/undefined — default to [].
function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function pickWorkloadFromQuery(raw: string | null): Workload {
  if (raw === 'command') return 'command';
  return 'scenario';
}

// Parses the `module` query-param (deep-link / bulk-run) into (name, state).
// Full address `core.cmd.shell` -> name=`core.cmd`, state=`shell`. Default —
// core.cmd.shell. Plugin modules in the `official.postgres-user.present` format also
// split correctly (the last segment is the state).
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

  // Any explicit query-param = deep-link intent -> the draft is ignored (a fresh
  // entry via bulk-run/link starts over). Without query-params we restore
  // the saved draft (navigation away/back between steps).
  const hasQueryIntent = useMemo(
    () =>
      ['workload', 'service', 'scenario', 'incarnation', 'incarnation_regex', 'module', 'target_incarnation', 'target_coven', 'target_regex', 'target_sids'].some(
        (k) => searchParams.has(k),
      ),
    [searchParams],
  );
  const draft = useMemo<WizardDraft | null>(
    () => (hasQueryIntent ? null : loadDraft()),
    // read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const initialWorkload = pickWorkloadFromQuery(searchParams.get('workload'));
  const initialService = searchParams.get('service') ?? '';
  const initialScenario = searchParams.get('scenario') ?? '';
  const initialIncarnation = searchParams.get('incarnation') ?? '';
  // incarnation_regex — a raw regex from snapshot-Run (IncarnationsList.handleRunSet).
  // Passed through as-is into incarnationRegex without re-escaping/wrapping.
  const initialIncarnationRegex = searchParams.get('incarnation_regex') ?? '';
  const initialModuleParam = searchParams.get('module');

  // Pre-fill host-criteria from the query (bulk-run actions from list pages):
  //   target_sids -> no direct mapping to criteria; stored as a sidRegex-anchor-OR
  //   target_coven -> covens; target_regex -> sidRegex; target_where is not mapped
  //   to the DSL (raw CEL), ignored in criteria mode.
  const initialCriteria = useMemo<HostCriteria>(
    () => criteriaFromQuery(searchParams),
    // read searchParams once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const hasCriteriaFromQuery = useMemo(
    () => hasAnyCriteria(initialCriteria),
    [initialCriteria],
  );

  // Multi-console leaves the wizard entirely (see WORKLOADS). `?workload=console`
  // is honoured on entry so bulk-run links can target the wall directly.
  const openConsole = useCallback(
    () => navigate(consoleHrefFrom(searchParams)),
    [navigate, searchParams],
  );
  useEffect(() => {
    if (searchParams.get('workload') === 'console') navigate(consoleHrefFrom(searchParams), { replace: true });
  }, [searchParams, navigate]);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(draft?.step ?? 1);
  const [workload, setWorkload] = useState<Workload>(draft?.workload ?? initialWorkload);
  const [runMode, setRunMode] = useState<RunMode>(() => {
    if (draft) return draft.runMode ?? 'voyage';
    // deep-link ?recurrence=true -> immediately opens cadence mode
    return searchParams.get('recurrence') === 'true' ? 'cadence' : 'voyage';
  });

  // Sub-state initialization: if a draft exists — default-merge at the
  // sub-object level (a new field always has the default value if it's
  // missing from the draft), array fields are additionally type-guarded via asArray.
  // Without a draft — initial from the query (or defaults).
  const [scenarioState, setScenarioState] = useState<ScenarioStateValues>(() => {
    if (draft) {
      const d = draft.scenarioState ?? {};
      return {
        ...DEFAULT_SCENARIO_STATE,
        ...d,
        incarnations: asArray(d.incarnations, DEFAULT_SCENARIO_STATE.incarnations),
      };
    }
    // Priority: incarnation_regex (snapshot-OR, already a ready regex) > incarnation (single incarnation).
    const regexFromSnapshot = initialIncarnationRegex;
    const regexFromSingle = initialIncarnation ? `^${escapeRegex(initialIncarnation)}$` : '';
    const incarnationRegex = regexFromSnapshot || regexFromSingle;
    // incarnations pre-fill only for a single deep-link (snapshot-list is resolved in Step3).
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
    // If ?module= is set with params -> pre-fill paramFields once the catalog loads.
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
        excluded: asArray(d.excluded, EMPTY_HOST_CRITERIA.excluded),
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

  // Errors for map fields and pattern fields (bubbled up from ScenarioInputFields).
  // Included in the submit gate alongside invalidCompositeFields/missingRequired.
  const [scenarioInvalidMaps, setScenarioInvalidMaps] = useState<string[]>([]);
  const [scenarioPatternErrors, setScenarioPatternErrors] = useState<string[]>([]);
  const [commandInvalidMaps, setCommandInvalidMaps] = useState<string[]>([]);
  const [commandPatternErrors, setCommandPatternErrors] = useState<string[]>([]);

  // Persist the draft on every wizard-state change. sessionStorage —
  // survives navigation within the browser tab, cleared on tab close.
  useEffect(() => {
    const payload: WizardDraft = { v: DRAFT_VERSION, step, workload, runMode, scenarioState, commandState, hostCriteria, options, cadenceState, notify };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage unavailable (private-mode/quota) — persist is optional, don't crash.
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

  // NIM-76: operational update_config — Redis version isn't set in the form, we take it from
  // the incarnation's state.redis_version (the first of the resolved set). Gated on the presence
  // of an x-directives field in the schema (don't fetch incarnation/catalog for non-redis scenarios).
  const hasDirectiveField = useMemo(() => schemaHasDirectiveField(inputSchema), [inputSchema]);
  // Directive validation (hard-block, 3A) applies ONLY to a single target: with
  // fan-out onto >1 incarnation their redis_version can differ -> one version would
  // hard-block ones valid on others. >1 -> graceful (no validation; backend 422 is final).
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

  // --- Host resolution for Command (live preview + submit). ---
  // Always load the soul list (for preview); filtering is client-side. Every page
  // of it, not the first: the criteria are matched against whatever this returns
  // and the survivors are shipped as an explicit `target.sids`, so a host missing
  // from the answer is a host missing from the run (NIM-448).
  const soulsListQ = useQuery({
    queryKey: ['run.command.souls.list'],
    queryFn: () => keeperApi.souls.listAll(),
    enabled: workload === 'command',
  });
  const allSouls = useMemo<SoulListEntry[]>(() => soulsListQ.data?.items ?? [], [soulsListQ.data]);
  // The fleet outgrew the read cap: the criteria were matched against a prefix of
  // the registry, so the preview is a lower bound. Said out loud in Step 2 rather
  // than left for the operator to infer from a counter.
  const soulsTruncated = soulsListQ.data?.truncated ?? false;
  const soulsScanned = allSouls.length;
  const soulsTotal = soulsListQ.data?.total ?? 0;

  const parsedSoulprint = useMemo(() => parseCriteriaSoulprint(hostCriteria), [hostCriteria]);
  const sidRegexComp = useMemo(() => compileSidRegex(hostCriteria.sidRegex), [hostCriteria.sidRegex]);

  // The incarnation criterion is a membership question (NIM-449) — one roster
  // fetch per name, not a scan of the coven column.
  const membership = useIncarnationMembers(hostCriteria.incarnations);

  // Stage 1: stable criteria (incarnation/coven/sid-regex) — without a soulprint-fetch.
  const stableMatched = useMemo<SoulListEntry[]>(() => {
    if (workload !== 'command' || !hasAnyCriteria(hostCriteria)) return [];
    return allSouls.filter((s) => matchStableCriteria(s, hostCriteria, sidRegexComp.re, membership.memberSids));
  }, [workload, hostCriteria, allSouls, sidRegexComp.re, membership.memberSids]);

  // Stage 2: soulprint-fetch only for the already-filtered stable candidates and
  // only if a soulprint criterion is set.
  //
  // NO criterion, NO array. `enabled: false` stops the requests but not the
  // observers: react-query builds one per descriptor, so handing it a descriptor
  // per candidate costs the same whether or not it fetches. That was invisible
  // while the candidate set could not exceed one page; against the whole registry
  // (NIM-448) it locks the tab on a fleet of tens of thousands.
  //
  // And past SOULPRINT_FANOUT_LIMIT candidates the stage does not run at all —
  // see the constant. Refusing is the point: evaluating the filter over a slice
  // of the candidates and reporting the survivors as the target is the silent
  // shortfall this whole change exists to remove.
  const soulprintActive = needsSoulprint(hostCriteria);
  const soulprintOverload = soulprintActive && stableMatched.length > SOULPRINT_FANOUT_LIMIT;
  const soulprintEnabled = workload === 'command' && soulprintActive && !soulprintOverload;
  const soulprintQueries = useQueries({
    queries: soulprintEnabled
      ? stableMatched.map((row) => ({
          queryKey: ['soulprint', row.sid] as const,
          queryFn: async () => {
            try {
              return await keeperApi.souls.getSoulprint(row.sid);
            } catch {
              return null;
            }
          },
          staleTime: 60_000,
        }))
      : [],
  });

  const soulprintLoading = soulprintEnabled && soulprintQueries.some((res) => res.isLoading);

  // Stage 3: final SID list after soulprint rules.
  const resolvedSouls = useMemo<SoulListEntry[]>(() => {
    // Nothing resolved, deliberately: the criteria have no answer we are willing
    // to compute, and an empty target keeps Next disabled until they narrow.
    if (soulprintOverload) return [];
    if (!soulprintActive) return stableMatched;
    const out: SoulListEntry[] = [];
    for (let i = 0; i < stableMatched.length; i++) {
      const sp = soulprintQueries[i]?.data;
      if (matchSoulprint(sp?.typed_facts, parsedSoulprint.rules)) out.push(stableMatched[i]);
    }
    return out;
    // soulprintQueries — an array of result objects, referentially stable within a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    soulprintActive,
    soulprintOverload,
    stableMatched,
    parsedSoulprint.rules,
    soulprintQueries.map((q) => q.data),
  ]);

  const resolvedSids = useMemo(() => resolvedSouls.map((s) => s.sid), [resolvedSouls]);

  // A `?target_sids=` link names its hosts outright — the roster's own row set,
  // when the link came from the Members table's run button. Those names are turned
  // into a SID regex and re-resolved against the registry, so a SID the registry
  // does not carry (out of the operator's `soul.list` scope, or a row the members
  // table only had from telemetry) matches nothing and leaves without a word.
  // Naming it is the whole point: the button promised THESE hosts.
  //
  // Only while the criteria are untouched. Once the operator edits them, hosts
  // dropping out is what they asked for, and the notice would be noise.
  // Deduplicated: a link repeating a SID asks for one host, and counting it twice
  // would make "N of M" disagree with the row count the operator came from.
  const requestedSids = useMemo(
    () => Array.from(new Set(splitCsv(searchParams.get('target_sids') ?? ''))),
    // read searchParams once on mount, like initialCriteria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const criteriaUntouched = useMemo(
    () => sameCriteria(hostCriteria, initialCriteria),
    [hostCriteria, initialCriteria],
  );
  // A Cadence with a coven ships `target.coven[]` and lets the Keeper resolve the
  // hosts on every tick (see buildRecipePayload) — the client's SID list is not
  // the target, so a SID missing from the client's read says nothing about what
  // will run. Only the runs that actually ship `target.sids` can under-deliver.
  const shipsResolvedSids = !(runMode === 'cadence' && hostCriteria.covens.length > 0);
  const unresolvedRequestedSids = useMemo(() => {
    if (workload !== 'command' || requestedSids.length === 0 || !criteriaUntouched) return [];
    if (!shipsResolvedSids) return [];
    // No answer yet, or no answer at all: an unread registry resolves nothing, and
    // blaming the SIDs for a failed request would point the operator at the wrong
    // problem. The query's own error surfaces elsewhere.
    if (soulsListQ.isLoading || soulsListQ.isError || !soulsListQ.data || soulprintLoading) {
      return [];
    }
    const resolved = new Set(resolvedSids);
    return requestedSids.filter((sid) => !resolved.has(sid));
  }, [
    workload,
    requestedSids,
    criteriaUntouched,
    shipsResolvedSids,
    soulsListQ.isLoading,
    soulsListQ.isError,
    soulsListQ.data,
    soulprintLoading,
    resolvedSids,
  ]);

  // The criteria resolve under `soul.list`, but the run is authorized under `errand.run`.
  // A narrower `errand.run` refuses the WHOLE run on one host it does not cover, so the
  // operator has to be able to drop that host — including when the target arrived
  // pre-filled from a bulk-run link and no checkbox ever existed for it.
  const targetSids = useMemo(() => applyExclusions(resolvedSids, hostCriteria), [resolvedSids, hostCriteria]);
  const excludedSids = useMemo(() => activeExclusions(resolvedSids, hostCriteria), [resolvedSids, hostCriteria]);

  const excludeHost = useCallback((sid: string) => {
    setHostCriteria((prev) => (prev.excluded.includes(sid) ? prev : { ...prev, excluded: [...prev.excluded, sid] }));
  }, []);

  // --- Incarnation resolution for Scenario (preview + multi-select). ---
  const incarnationsListQ = useQuery({
    queryKey: ['run.scenario.incarnations.list', scenarioState.service],
    queryFn: () => keeperApi.incarnations.list({ service: scenarioState.service, limit: 500 }),
    enabled: workload === 'scenario' && Boolean(scenarioState.service),
  });

  const incarnationNames = useMemo(
    () => (incarnationsListQ.data?.items ?? []).map((i) => i.name),
    [incarnationsListQ.data],
  );

  // Host count per incarnation, read from each ROSTER — the relation a scenario
  // run fans out over.
  //
  // It used to be a single `GET /v1/souls?coven=<all the names>` with the reply's
  // label column tallied per name. That agreed with the roster only while ADR-080
  // had a host inherit the name of every incarnation it belonged to; NIM-281
  // reverted the inheritance, so the tally counts whoever happens to carry a tag
  // spelled like an incarnation — every member nobody tagged is missing from a
  // number the operator reads as the size of the fan-out.
  //
  // A name whose roster did not arrive keeps NO entry, and the picker renders
  // that as an unknown count rather than as zero.
  //
  // Gated on the step that shows the numbers, not merely on the workload: this is
  // one request per incarnation of the service, and the service is already chosen
  // on step 2. Without the step in the condition, picking a service fires the whole
  // fan-out immediately for counts the operator may never reach.
  const rosterSizes = useIncarnationRosterSizes(incarnationNames, workload === 'scenario' && step >= 3);
  const hostCountByIncarnation = useMemo<Record<string, number> | undefined>(() => {
    if (rosterSizes.sizeByName.size === 0) return undefined;
    const counts: Record<string, number> = {};
    for (const [name, size] of rosterSizes.sizeByName) counts[name] = size;
    return counts;
  }, [rosterSizes.sizeByName]);

  // --- Step validation. ---
  const canAdvanceFromStep2 = useMemo(() => {
    if (workload === 'scenario') {
      return Boolean(scenarioState.service && scenarioState.scenario);
    }
    // command: Step2 — host selection; needs at least one criterion AND a non-empty target
    // (a resolution the operator excluded down to zero is just as unrunnable as no match).
    return hasAnyCriteria(hostCriteria) && targetSids.length > 0;
  }, [workload, scenarioState, hostCriteria, targetSids]);

  // Empty required fields of the scenario's typed input_schema (mirrors backend 422).
  // Accounts for show_when: hidden fields are excluded from the gate.
  const scenarioMissingRequired = useMemo(
    () => {
      if (workload !== 'scenario' || !usePerField) return [];
      const visibleFields = computeVisibleFields(selectedScenarioMeta?.form, scenarioState.fields);
      return missingRequiredFields(inputSchema, scenarioState.fields, visibleFields);
    },
    [workload, usePerField, inputSchema, scenarioState.fields, selectedScenarioMeta?.form],
  );

  // Composite fields (array/object) with unparseable JSON — block submit/"Next".
  const scenarioInvalidComposite = useMemo(
    () => (workload === 'scenario' && usePerField ? invalidCompositeFields(inputSchema, scenarioState.fields) : []),
    [workload, usePerField, inputSchema, scenarioState.fields],
  );

  // Empty required params of the typed form (modules with params[]).
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
    // Free-text fallback (catalog unavailable): a module name is needed.
    if (!commandState.moduleName.trim()) return false;
    // A module with params — all required filled, no map errors and no pattern errors.
    if (hasParams(commandState.moduleParams)) {
      return (
        commandMissingRequired.length === 0 &&
        commandInvalidMaps.length === 0 &&
        commandPatternErrors.length === 0
      );
    }
    // A module without formalized params (free-text fallback) — the name is enough.
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

  /** Converts a datetime-local string to ISO-8601 with a timezone for OpenAPI date-time.
   * Empty string -> undefined. Invalid Date -> undefined (guard, never reaches submit). */
  function scheduleAtIso(raw: string): string | undefined {
    const s = raw.trim();
    if (!s) return undefined;
    const d = new Date(s);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  // Builds the common options part for both workloads.
  function buildOptionsPayload() {
    const c = parseIntOrEmpty(options.concurrency);
    const concurrency = c && c > 0 ? c : 50;
    const batchMode = options.batchMode;

    // New string fields batch / max_failures — send the raw string, Keeper parses it.
    // Empty string = not set -> the field isn't sent (undefined -> omit).
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
   * Builds the recipe part (kind + workload fields + target).
   *
   * forCadence=true (command): sends declared criteria (coven/where) instead of
   * snapshot sids, so the backend resolves the target on every tick (late-binding).
   *
   * Exception — if coven isn't set and the operator used only
   * regex/soulprint: falls back to snapshot sids (declared-target would be empty).
   * The UI warns about this with the cadenceSnapshotOnlyWarn banner.
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
      // Full module address — `<name>.<state>` (state is omitted if empty —
      // the free-text fallback may not have set it).
      const moduleName = commandState.moduleState
        ? `${commandState.moduleName}.${commandState.moduleState}`
        : commandState.moduleName;
      let input: Record<string, unknown>;
      if (hasParams(commandState.moduleParams)) {
        input = serializeFields(paramsToInputSchema(commandState.moduleParams), commandState.paramFields);
      } else {
        input = commandState.customInput;
      }

      // Cadence (forCadence=true): send declared coven criteria for late-binding.
      // The backend Voyage-resolver supports `target.coven[]` for kind=command and
      // resolves them into a host snapshot on every tick — new coven members get picked up.
      //
      // Exception: if coven isn't set (the operator only set sidRegex/soulprint), or if
      // hosts were dropped from the target (a declared coven is re-resolved on every tick
      // and would run on them again) -> fallback to snapshot sids (UI warns).
      if (forCadence && hostCriteria.covens.length > 0 && excludedSids.length === 0) {
        const declaredTarget: VoyageTarget = { coven: hostCriteria.covens };
        // where isn't evaluated in the MVP (backend stores it, doesn't apply it), but
        // we pass it for future compatibility, in case the operator set it via the UI.
        return {
          kind: 'command',
          module: moduleName,
          input: Object.keys(input).length > 0 ? input : undefined,
          target: declaredTarget,
        };
      }

      // A one-off Voyage or Cadence without coven: snapshot sids (correct per ADR-043 5/8).
      return {
        kind: 'command',
        module: moduleName,
        input: Object.keys(input).length > 0 ? input : undefined,
        target: { sids: targetSids },
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

  // batch — light UX validation: empty = ok; if filled — must match
  // the keeper grammar (^(\d+)%?$). Authoritative check — on the backend (422).
  // window + non-empty batch -> backend returns 422 (we silently block only obviously garbage formats).
  const batchValid = useMemo(() => {
    const s = options.batch.trim();
    if (!s) return true; // empty — ok
    return BATCH_FORMAT_RE.test(s);
  }, [options.batch]);

  // scheduleAt — optional field; if set, must be in the future.
  const scheduleAtValid = useMemo(() => {
    const s = options.scheduleAt.trim();
    if (!s) return true; // empty — immediate start, valid
    return new Date(s) > new Date();
  }, [options.scheduleAt]);

  // Cadence-specific validation for Step 4.
  const cadenceValid = useMemo(() => {
    if (runMode !== 'cadence') return true;
    if (!cadenceState.cadenceName.trim()) return false;
    if (cadenceState.scheduleKind === 'interval') {
      const s = parseIntOrEmpty(cadenceState.intervalSeconds);
      return Boolean(s && s >= CONSTRAINTS.cadenceIntervalSecondsMin);
    }
    // cron: non-empty string (format is checked by the backend)
    return cadenceState.cronExpr.trim().length > 0;
  }, [runMode, cadenceState]);

  const canSubmit = canAdvanceFromStep2 && canAdvanceFromStep3 && batchValid && (runMode === 'cadence' ? cadenceValid : scheduleAtValid) && !submitMu.isPending;

  // --- Batch preview logic ---
  // Snapshot target: explicit SID / regex / incarnations — scope known to the client.
  // Late-binding target: coven — scope resolved by Keeper; needs /preview.
  //
  // For Command: coven[] non-empty -> late-binding.
  // For Scenario: incarnations[] — snapshot (list known after regex resolution).
  // Dropped hosts force the snapshot form: a declared coven is re-resolved by Keeper and
  // would put them back.
  const isLateBinding = workload === 'command' && hostCriteria.covens.length > 0 && hostCriteria.sidRegex.trim().length === 0 && hostCriteria.soulprint.trim().length === 0 && excludedSids.length === 0;

  // Scope for snapshot-count: for scenario = number of incarnations; for command = target size.
  const snapshotScope = workload === 'scenario' ? scenarioState.incarnations.length : targetSids.length;

  // Local computation of the batch count for a snapshot target.
  // batch = '' | 'N' | 'N%'. For window — always 1 (batch isn't used in window semantics).
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

  const previewModule = commandState.moduleState
    ? `${commandState.moduleName}.${commandState.moduleState}`
    : commandState.moduleName;

  // Pre-flight for a one-off Command run. /v1/voyages/preview runs the SAME resolve and
  // the SAME gates as create without persisting anything, so a 403 here IS the refusal the
  // operator would get on submit — surfaced before they compose the command.
  //
  // Cadence is deliberately excluded: its create checks `errand.run` — and the console
  // gate — BARE, and resolves the target only at spawn time. A per-host verdict here would
  // tell the operator a recipe will be refused that the backend accepts.
  const preflightApplies = workload === 'command' && runMode === 'voyage';

  // The explicit host list a refusal can name. Empty for a late-binding (coven) target:
  // there is no snapshot to drop a host from, so such a refusal is reported without a
  // remedy rather than blamed on an arbitrary host.
  const preflightSids = useMemo(
    () => (preflightApplies && !isLateBinding && previewModule ? targetSids : []),
    [preflightApplies, isLateBinding, previewModule, targetSids],
  );

  // Preview request (debounce on TARGET change — not on batch input).
  // Builds the preview body like buildRecipePayload() + buildOptionsPayload(), but without a draft.
  // We cannot call build* inside useMemo/useCallback (they read state via closure),
  // so we compute primitive keys right here for a stable queryKey.
  const previewTargetKey = useMemo(
    () =>
      isLateBinding
        ? JSON.stringify({ covens: hostCriteria.covens.slice().sort() })
        : preflightSids.length > 0
          ? previewTargetKeyForSids(preflightSids, previewModule)
          : null,
    [isLateBinding, hostCriteria.covens, preflightSids, previewModule],
  );

  // Build the preview body only when needed (lazy).
  const buildPreviewBody = useCallback((): VoyageCreateRequest | null => {
    const target: VoyageTarget | null = isLateBinding
      ? { coven: hostCriteria.covens }
      : preflightSids.length > 0
        ? { sids: preflightSids }
        : null;
    if (!target) return null;
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
      target,
      concurrency,
      batch_mode: options.batchMode,
      batch,
      max_failures,
      dry_run: false,
      require_alive: options.requireAlive,
      on_failure: options.onFailure,
    };
  }, [isLateBinding, preflightSids, commandState, hostCriteria.covens, options]);

  // Debounce the target key for the preview request: change queryKey only after the target settles.
  const previewTargetKeyDebounced = useDebounce(previewTargetKey, 400);

  // require_alive belongs in the key, not just in the body: it changes which hosts the
  // backend resolves, so a stale verdict would otherwise survive the operator toggling it
  // — either accusing a host the filter just removed, or staying silent about one it
  // brought back. The other body fields do not move the resolve.
  const previewQ = useQuery({
    queryKey: ['voyage.preview', previewTargetKeyDebounced, options.batchMode, options.requireAlive],
    queryFn: async () => {
      const body = buildPreviewBody();
      if (!body) return null;
      return keeperApi.voyages.preview(body);
    },
    enabled: previewTargetKeyDebounced !== null && step === 4,
    staleTime: 30_000,
    retry: false,
  });

  // The hosts the pre-flight ACTUALLY asked about. The key is debounced and the target is
  // not, so matching a refusal against the on-screen target would, for the 400 ms after an
  // edit, hunt the previous verdict's host in the new list and quietly drop the button.
  const preflightSidsAsked = useMemo(
    () => sidsFromPreviewKey(previewTargetKeyDebounced),
    [previewTargetKeyDebounced],
  );

  // Only a 403 is actionable. Every other pre-flight failure (429 Tempo, a network blip,
  // an endpoint that isn't there) is graceful-degraded away: the backend stays the
  // authority on submit, and a flaky probe must never stand between the operator and a
  // run it cannot actually prove is forbidden.
  const preflightDenial = useMemo(() => {
    if (!preflightApplies) return null;
    const err = previewQ.error;
    if (!(err instanceof ApiError) || err.status !== 403) return null;
    return { detail: err.detail, sid: deniedHostFromDetail(err.detail, preflightSidsAsked) };
  }, [preflightApplies, previewQ.error, preflightSidsAsked]);

  // The furthest step reachable by validation (gate per step). The stepper marks
  // "done" only for steps actually completed and blocks jumping forward past an invalid
  // step — previously clicking on step "4" marked all previous steps done (white), even if
  // their data hadn't been entered.
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
            onOpenConsole={openConsole}
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
            soulsLoading={soulsListQ.isLoading || soulprintLoading || membership.loading}
            invalidSoulprint={parsedSoulprint.invalid}
            regexError={sidRegexComp.error}
            unresolvedIncarnations={membership.unresolved}
            runMode={runMode}
            soulsTruncated={soulsTruncated}
            soulsScanned={soulsScanned}
            soulsTotal={soulsTotal}
            soulprintOverload={soulprintOverload}
            soulprintCandidates={stableMatched.length}
            soulprintLimit={SOULPRINT_FANOUT_LIMIT}
            unresolvedRequestedSids={unresolvedRequestedSids}
            requestedSidCount={requestedSids.length}
          />
        ) : null}

        {step === 3 && workload === 'scenario' ? (
          <Step3ScenarioIncarnations
            value={scenarioState}
            onChange={setScenarioState}
            incarnationsLoading={incarnationsListQ.isLoading}
            incarnationNames={incarnationNames}
            hostCountByIncarnation={hostCountByIncarnation}
            hostCountOverCap={rosterSizes.overCap}
            hostCountLoading={rosterSizes.loading}
            unreadRosters={rosterSizes.unresolved}
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

        {/* Above the options, not next to the Run button: this says the run will be
            refused, which is a reason to stop reading the form rather than a footnote to
            it. The options block is long enough that anything under it is below the fold
            on arrival. */}
        {step === 4 && preflightDenial ? (
          <div className={pageStyles.errorBox} data-testid="preflight-denied">
            <div>{t('run:preflightDenied', { message: preflightDenial.detail })}</div>
            {preflightDenial.sid ? (
              <div style={{ marginTop: 8 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => excludeHost(preflightDenial.sid as string)}
                >
                  {t('run:preflightDropHost', { sid: preflightDenial.sid })}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Dropping the last host is reachable from the button above, and the Hosts step
            owns the usual "nothing left" warning — without this the submit button just
            goes dead with its reason two steps away. Keyed on the criteria having resolved
            to something first: an empty resolve is a different problem (still loading a
            roster, or matching nothing) that the Hosts step explains. */}
        {step === 4 && workload === 'command' && resolvedSids.length > 0 && targetSids.length === 0 ? (
          <div className={pageStyles.errorBox} data-testid="target-empty-after-drop">
            {t('run:targetEmptyAfterDrop')}
          </div>
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
  // The furthest step validation has reached. A step counts as "done" (completed)
  // only if it's behind the current one and its gate is actually passed; jumping forward past this
  // limit is disallowed.
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
    <ol className={styles.steps} aria-label={t('run:wizardStepsAria')}>
      {STEPS.map((s) => {
        const active = s.id === step;
        // "done" = behind the current one AND validation has progressed past it (gate passed).
        const done = s.id < step && s.id < maxReachableStep;
        // Clickable: current, any completed/behind, or the next reachable one.
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
  onOpenConsole,
  runMode,
  onRunModeChange,
}: {
  workload: Workload;
  onWorkloadChange: (v: Workload) => void;
  onOpenConsole: () => void;
  runMode: RunMode;
  onRunModeChange: (v: RunMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Run mode: One-time / Recurring */}
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

      {/* Workload selection */}
      <div className={styles.radioRow} role="radiogroup" aria-label={t('run:workloadTypeAria')}>
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
                onChange={() => (w.kind === 'console' ? onOpenConsole() : onWorkloadChange(w.kind))}
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

// Step 2 Scenario: select service -> scenario.
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

// Step 3 Scenario: regex over incarnation name -> a read-only list of matches
// (fan-out onto ALL matches) + scenario input params. No selection (checkboxes):
// the set is defined by a single regex (the concept "scenario = run on N incarnations
// selected by regex").
function Step3ScenarioIncarnations({
  value,
  onChange,
  incarnationsLoading,
  incarnationNames,
  hostCountByIncarnation,
  hostCountOverCap,
  hostCountLoading,
  unreadRosters,
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
  // Dispatch (rather than a plain callback): the two derived effects below (defaults-seed and
  // matched-sync) use a functional update, otherwise their once-closed `value`
  // would overwrite each other's changes (a race between effects in the same render).
  onChange: Dispatch<SetStateAction<ScenarioStateValues>>;
  incarnationsLoading: boolean;
  incarnationNames: string[];
  hostCountByIncarnation: Record<string, number> | undefined;
  hostCountOverCap: boolean;
  hostCountLoading: boolean;
  unreadRosters: UnresolvedIncarnation[];
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
  const scenarioNote = splitScenarioNote(selectedScenarioMeta?.description);

  // Seed defaults when the supported schema changes, but do NOT overwrite already-entered/
  // draft-restored values (otherwise remounting the step would reset input).
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

  // Regex compilation.
  // `*` (exactly one character) -> special case "all": matches every incarnation of the service.
  // Empty string (or whitespace only) -> not set, INVALID (blocks "Next").
  // Invalid regex -> 0 matches + error.
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

  // The fan-out set is derived from the regex; synced into state so
  // submit/validation see the current list regardless of the step's render.
  const matchedKey = matched.join('\n');
  useEffect(() => {
    onChange((prev) => (matchedKey === prev.incarnations.join('\n') ? prev : { ...prev, incarnations: matched }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedKey]);

  const totalHosts = useMemo(
    () => totalRosterSize(matched, hostCountByIncarnation),
    [hostCountByIncarnation, matched],
  );

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
          aria-label={t('run:incarnationRegexAria')}
        />
        <span className={styles.hint}>{t('run:incarnationRegexHint')}</span>
        {filterRe.empty ? <span className={styles.warn}>{t('run:incarnationRegexEmptyHint')}</span> : null}
        {filterRe.error ? <span className={styles.warn}>{t('run:incarnationRegexInvalid')}</span> : null}
      </label>

      <div>
        <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
          {t('run:incarnationMatchedOf', { matched: matched.length, total: incarnationNames.length })}
        </div>
        {/* Past the fan-out cap every row below reads "unknown", and nothing else on
            screen says why. The notice also has to head off the obvious next move:
            the cap counts the SERVICE's incarnations, not the filtered ones, so
            tightening the filter changes nothing about it. */}
        {hostCountOverCap ? (
          <div className={styles.warn} style={{ marginBottom: 6 }} data-testid="host-count-over-cap">
            {t('run:hostCountOverCap', {
              count: incarnationNames.length,
              limit: ROSTER_SIZE_FANOUT_LIMIT,
            })}
          </div>
        ) : null}
        {/* Below the cap a blank count is an ANSWER, not a wait, and the three
            answers are three different next steps. Left unsaid, every one of them
            renders as the same dash the over-cap case explains — and the run goes
            ahead on those incarnations regardless, which is the part the operator
            has to be told. */}
        {UNRESOLVED_KEYS.map((reason) => {
          const names = unreadRosters.filter((u) => u.reason === reason).map((u) => u.name);
          if (names.length === 0) return null;
          return (
            <div
              key={reason}
              className={styles.warn}
              style={{ marginBottom: 6 }}
              data-testid={`host-count-${reason}`}
            >
              {t(UNREAD_ROSTER_KEY[reason], { names: names.join(', ') })}
            </div>
          );
        })}
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
          aria-label={t('run:matchedIncarnationsAria')}
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
                {/* Three states, not two: a count still on its way is not the
                    same news as one that will never come, and the dash is what
                    the notices above explain. */}
                <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                  {count !== undefined
                    ? t('run:hostCount', { count })
                    : hostCountLoading
                      ? t('run:hostCountLoading')
                      : t('run:hostCountUnknown')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.preview} aria-label={t('run:incarnationPreviewAria')}>
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
        {/* The number counts the roster as THIS operator may read it; the run
            resolves its hosts server-side with no caller scope and then drops the
            ones without a live lease. So it is short of the run in one direction
            and over it in the other, and the badge sits on the last screen before
            Run — where it would otherwise read as a promise. */}
        {totalHosts !== undefined ? (
          <span className={styles.hint} data-testid="total-hosts-hint">
            {t('run:totalHostsHint')}
          </span>
        ) : null}
      </div>

      {usePerField && inputSchema ? (
        <div>
          <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>
            {t('run:scenarioInputFieldsLabel', { scenario: value.scenario })}
          </div>
          {scenarioNote.lead ? (
            <div
              data-testid="scenario-note"
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                marginBottom: 10,
                padding: '8px 10px',
                fontSize: 12.5,
                lineHeight: 1.45,
                color: 'var(--text)',
                background: 'color-mix(in srgb, var(--info) 8%, var(--surface))',
                border: '1px solid color-mix(in srgb, var(--info) 35%, var(--border))',
                borderRadius: 'var(--radius)',
              }}
            >
              <Info size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--info)' }} />
              <span style={{ whiteSpace: 'pre-line' }}>{scenarioNote.lead}</span>
            </div>
          ) : null}
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
          {scenarioNote.rest ? (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-faint)', whiteSpace: 'pre-line' }}>
              {scenarioNote.rest}
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

// An incarnation whose roster did not arrive contributes no hosts, and the three
// causes are three different next steps for the operator: fix the name, ask for
// the permission, or retry. Silence would read as "that incarnation is empty".
const UNRESOLVED_INCARNATION_KEY: Record<MembershipFailure, string> = {
  unknown: 'run:hostIncarnationUnknown',
  forbidden: 'run:hostIncarnationForbidden',
  failed: 'run:hostIncarnationUnresolved',
};
const UNRESOLVED_KEYS = Object.keys(UNRESOLVED_INCARNATION_KEY) as MembershipFailure[];

// Same three causes on the scenario step, and deliberately NOT the same strings.
// There the roster decides which hosts are targeted, so a failure drops them; here
// the run targets every matching incarnation either way and only the COUNT is
// lost. Reusing the wording above would tell the operator hosts were dropped when
// nothing was.
const UNREAD_ROSTER_KEY: Record<MembershipFailure, string> = {
  unknown: 'run:hostCountUnknownIncarnation',
  forbidden: 'run:hostCountForbidden',
  failed: 'run:hostCountUnreadable',
};

// Step 2 Command: rich host selector. Criteria are combined (AND between different ones,
// OR within a list). Live preview of the resolved list + counter.
function Step2CommandHosts({
  value,
  onChange,
  resolvedSouls,
  soulsLoading,
  invalidSoulprint,
  regexError,
  unresolvedIncarnations,
  runMode,
  soulsTruncated,
  soulsScanned,
  soulsTotal,
  soulprintOverload,
  soulprintCandidates,
  soulprintLimit,
  unresolvedRequestedSids,
  requestedSidCount,
}: {
  value: HostCriteria;
  onChange: (next: HostCriteria) => void;
  resolvedSouls: SoulListEntry[];
  soulsLoading: boolean;
  invalidSoulprint: string[];
  regexError: string | null;
  unresolvedIncarnations: UnresolvedIncarnation[];
  runMode: RunMode;
  soulsTruncated: boolean;
  soulsScanned: number;
  soulsTotal: number;
  soulprintOverload: boolean;
  soulprintCandidates: number;
  soulprintLimit: number;
  unresolvedRequestedSids: string[];
  requestedSidCount: number;
}) {
  const { t } = useTranslation();
  const unresolvedSample = unresolvedRequestedSids.slice(0, 10);
  const active = hasAnyCriteria(value);
  const excludedSet = useMemo(() => new Set(value.excluded), [value.excluded]);

  // The first 50 resolved hosts, plus every dropped host beyond them: a checkbox the
  // operator cannot reach is a host they cannot put back.
  const sample = useMemo(() => visibleHostRows(resolvedSouls, value), [resolvedSouls, value]);
  const excludedCount = useMemo(
    () => activeExclusions(resolvedSouls.map((s) => s.sid), value).length,
    [resolvedSouls, value],
  );
  const targetCount = resolvedSouls.length - excludedCount;

  function toggleHost(sid: string, included: boolean) {
    onChange({
      ...value,
      excluded: included ? value.excluded.filter((s) => s !== sid) : [...value.excluded, sid],
    });
  }

  // Footgun banners for Cadence (late-binding warnings).
  // earlyBinding: coven is set, but regex/soulprint are also present — they are snapshot-only.
  const cadenceEarlyBindingWarn =
    runMode === 'cadence' &&
    value.covens.length > 0 &&
    (value.sidRegex.trim().length > 0 || value.soulprint.trim().length > 0);
  // snapshotOnly: no coven, but regex/soulprint present — the whole target will be a snapshot.
  const cadenceSnapshotOnlyWarn =
    runMode === 'cadence' &&
    value.covens.length === 0 &&
    (value.sidRegex.trim().length > 0 || value.soulprint.trim().length > 0);
  // Dropping hosts from a coven target also forces the snapshot form — otherwise Keeper
  // would resolve the coven afresh on every tick and run on them again.
  const cadenceExcludedSnapshotWarn = runMode === 'cadence' && value.covens.length > 0 && excludedCount > 0;

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
        {UNRESOLVED_KEYS.map((reason) => {
          const names = unresolvedIncarnations.filter((u) => u.reason === reason).map((u) => u.name);
          if (names.length === 0) return null;
          return (
            <div key={reason} className={styles.warn} data-testid={`host-incarnation-${reason}`}>
              {t(UNRESOLVED_INCARNATION_KEY[reason], { names: names.join(', ') })}
            </div>
          );
        })}
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
          aria-label={t('run:sidRegexAria')}
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
          aria-label={t('run:soulprintFilterAria')}
        />
        {invalidSoulprint.length > 0 ? (
          <span className={styles.warn}>
            {t('run:soulprintUnrecognized', { tokens: invalidSoulprint.join(', ') })}
          </span>
        ) : null}
      </label>

      {/* Footgun warnings for Cadence: shown above the preview */}
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
      {cadenceExcludedSnapshotWarn ? (
        <div className={styles.warn} data-testid="cadence-excluded-snapshot-warn" style={{ marginBottom: 4 }}>
          {t('run:cadenceExcludedSnapshotWarn')}
        </div>
      ) : null}

      <div className={styles.preview} aria-label={t('run:hostPreviewAria')}>
        {soulsTruncated ? (
          <div className={styles.warn} data-testid="souls-truncated-warn" style={{ marginBottom: 6 }}>
            {t('run:hostsRegistryTruncated', { scanned: soulsScanned, total: soulsTotal })}
          </div>
        ) : null}
        {soulprintOverload ? (
          <div className={styles.warn} data-testid="soulprint-overload-warn" style={{ marginBottom: 6 }}>
            {t('run:hostsSoulprintTooMany', { count: soulprintCandidates, limit: soulprintLimit })}
          </div>
        ) : null}
        {!active ? (
          <div>{t('run:hostCriteriaEmpty')}</div>
        ) : soulprintOverload ? null : (
          <>
            <div>
              <Badge tone="info">{t('run:hostsMatch', { count: resolvedSouls.length })}</Badge>
              {excludedCount > 0 ? (
                <span style={{ marginLeft: 8 }} data-testid="hosts-excluded">
                  {t('run:hostsExcluded', { count: excludedCount })}
                </span>
              ) : null}
              {soulsLoading ? <span style={{ marginLeft: 8 }}>{t('loading')}</span> : null}
            </div>
            {unresolvedRequestedSids.length > 0 ? (
              <div className={styles.warn} data-testid="targets-unresolved-warn" style={{ marginTop: 6 }}>
                {t('run:hostsTargetsUnresolved', {
                  count: unresolvedRequestedSids.length,
                  total: requestedSidCount,
                  sids: unresolvedSample.join(', '),
                })}
                {unresolvedRequestedSids.length > unresolvedSample.length ? (
                  <> {t('run:hostsMore', { count: unresolvedRequestedSids.length - unresolvedSample.length })}</>
                ) : null}
              </div>
            ) : null}
            {sample.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                {sample.map((s) => (
                  <label key={s.sid} style={{ display: 'block', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!excludedSet.has(s.sid)}
                      onChange={(e) => toggleHost(s.sid, e.target.checked)}
                      aria-label={t('run:hostIncludeAria', { sid: s.sid })}
                      style={{ marginRight: 6 }}
                    />
                    <span style={excludedSet.has(s.sid) ? { color: 'var(--text-faint)', textDecoration: 'line-through' } : undefined}>
                      {s.sid}
                    </span>
                  </label>
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
            {!soulsLoading && resolvedSouls.length > 0 && targetCount === 0 ? (
              <span className={styles.warn} data-testid="hosts-all-excluded">{t('run:hostsAllExcluded')}</span>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

// Step 3 Command: module search (catalog GET /v1/modules) + a typed
// params form / cmd fields / free-text fallback.
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

  // On the first render moduleParams may be empty (state was initialized with a default without
  // touching the catalog). Pull params from the React Query cache once the catalog loads.
  // queryKey matches ModulePicker(errandSafe=true) -> a single shared cache, no duplicate request.
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

  // Selecting a module from the catalog: apply name, kind, params and the first state.
  // Reset the form (cmd / paramFields) so old module values don't carry over.
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
              aria-label={t('run:customModuleNameAria')}
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

      {/* State selection, if the module has more than one (full address is name.state). */}
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
          aria-label={t('run:timeoutSecondsAria')}
        />
      </label>
    </>
  );
}

// Selection of the state suffix, if the selected module has more than one (`core.service` —
// running/stopped/...). With a single/zero state the section is hidden (state
// is already set in onSelectModule). Full submit address is `moduleName.moduleState`.
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
        aria-label={t('run:moduleStateAria')}
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

  // Compute the UTC equivalent of the filled field for display next to the hint.
  const scheduleAtUtc = useMemo(() => {
    const s = value.scheduleAt.trim();
    if (!s) return null;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toUTCString();
  }, [value.scheduleAt]);

  return (
    <>
      {/* "Batching" section — batch size/threshold + behavior on batch-runner failure
          (on_failure is logically about batching itself, not about run timing). */}
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

        {/* Unified batch text field (N | N%) — hidden for window */}
        {!isWindow ? (
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('run:batchLabel')}</span>
            <input
              type="text"
              className={styles.field}
              value={value.batch}
              onChange={(e) => onChange({ ...value, batch: e.target.value })}
              placeholder={t('run:batchPlaceholder')}
              aria-label={t('run:batchAria')}
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

        {/* max_failures — always visible (works in both batch_mode values) */}
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
            aria-label={t('run:maxFailuresAria')}
          />
          <span className={styles.hint}>{t('run:maxFailuresHint')}</span>
        </label>

        {/* Batch count preview */}
        {!isWindow && (isLateBinding ? (
          previewLoading ? (
            <div className={styles.hint} aria-label={t('run:batchPreviewAria')}>
              {t('run:batchPreviewLoading')}
            </div>
          ) : previewData ? (
            <div className={styles.hint} aria-label={t('run:batchPreviewAria')} data-testid="batch-preview">
              {previewData.batch_mode === 'window'
                ? t('run:batchPreviewWindow')
                : t('run:batchPreviewBatches', { count: previewData.total_batches, scope: previewData.scope_size })}
            </div>
          ) : null
        ) : (
          localBatchCount !== null && snapshotScope > 0 ? (
            <div className={styles.hint} aria-label={t('run:batchPreviewAria')} data-testid="batch-preview">
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
            aria-label={t('run:concurrencyAria')}
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

        {/* inter_batch_interval_ms — barrier only */}
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
              aria-label={t('run:interBatchIntervalAria')}
            />
            <span className={styles.hint}>{t('run:interBatchIntervalHint')}</span>
          </label>
        ) : null}

        {/* inter_unit_interval_ms — window only */}
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
              aria-label={t('run:interUnitIntervalAria')}
            />
            <span className={styles.hint}>{t('run:interUnitIntervalHint')}</span>
          </label>
        ) : null}
      </fieldset>

      {/* "Scheduling" section — when the run starts: one-off (schedule_at) or
          on a schedule (Cadence: interval/cron/overlap_policy). */}
      <fieldset className={styles.optionsSection}>
        <legend className={styles.optionsSectionLegend}>{t('run:sectionSchedulingLabel')}</legend>

        {runMode === 'cadence' ? (
          /* Cadence fields instead of scheduleAt */
          <fieldset
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
          >
            <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
              {t('run:cadenceScheduleLabel')}
            </legend>

            {/* Cadence name */}
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('run:cadenceNameLabel')}</span>
              <input
                type="text"
                className={styles.field}
                value={cadenceState.cadenceName}
                onChange={(e) => onCadenceChange({ ...cadenceState, cadenceName: e.target.value })}
                placeholder={t('run:cadenceNamePlaceholder')}
                aria-label={t('run:cadenceNameAria')}
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
                  aria-label={t('run:cadenceIntervalAria')}
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
                  aria-label={t('run:cadenceCronAria')}
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
                aria-label={t('run:cadenceOverlapAria')}
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
              aria-label={t('run:scheduleAtAria')}
            />
            <span className={styles.hint}>{t('run:scheduleAtHint')}</span>
            {scheduleAtUtc ? <span className={styles.hint}>{t('run:scheduleAtUtc', { utc: scheduleAtUtc })}</span> : null}
            {!scheduleAtValid ? <span className={styles.warn}>{t('run:scheduleAtPastError')}</span> : null}
          </label>
        )}
      </fieldset>

      {/* "Flags" section — boolean toggles for run behavior. */}
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
            aria-label={t('run:waitAria')}
          />
          {t('run:waitLabel')}
        </label>
      </fieldset>

      {/* Notifications block — for Voyage (one-off) and Cadence (permanent, mode=permanent) */}
      <NotifyBlock
        value={notify}
        onChange={onNotifyChange}
        mode={runMode === 'cadence' ? 'permanent' : 'ephemeral'}
      />
    </>
  );
}

// --- helpers ---

// Restoring host-criteria from URL search-params (bulk-run actions from
// list pages). target_incarnation -> incarnations; target_coven -> covens;
// target_regex -> sidRegex; target_sids -> sidRegex anchored-OR (exact SID
// list); target_where (raw CEL) and target_glob are not mapped into the criteria
// DSL — ignored.
//
// `target_incarnation` NAMES a set instead of enumerating it, which is the whole
// point of it existing next to `target_sids` (NIM-451). A link that spells out
// every SID grows with the fleet: over a 2000-host roster it reached 52 KB, and
// Keeper caps request headers at 16 KiB on purpose (api/server.go), so reloading
// or bookmarking such a link answers 431 — no reverse proxy required, and the
// cliff arrives around 500-700 hosts, not thousands. This one is constant-size.
//
// It resolves through the roster (useIncarnationMembers → GET
// /v1/incarnations/{name}/members), NOT through the Coven column that happens to
// carry the same name — the distinction NIM-443 and NIM-449 exist for.
function criteriaFromQuery(params: URLSearchParams): HostCriteria {
  const incarnationRaw = params.get('target_incarnation');
  const covenRaw = params.get('target_coven');
  const regexRaw = params.get('target_regex');
  const sidsRaw = params.get('target_sids');
  const incarnations = incarnationRaw ? splitCsv(incarnationRaw) : [];
  const covens = covenRaw ? splitCsv(covenRaw) : [];
  let sidRegex = regexRaw ?? '';
  if (!sidRegex && sidsRaw) {
    const sids = splitCsv(sidsRaw);
    if (sids.length > 0) {
      const escaped = sids.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
      sidRegex = `^(${escaped.join('|')})$`;
    }
  }
  return { incarnations, covens, sidRegex, soulprint: '', excluded: [] };
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Whether the operator has left the criteria exactly as the deep-link built them.
function sameCriteria(a: HostCriteria, b: HostCriteria): boolean {
  return (
    a.sidRegex === b.sidRegex &&
    a.soulprint === b.soulprint &&
    a.incarnations.length === b.incarnations.length &&
    a.incarnations.every((v, i) => v === b.incarnations[i]) &&
    a.covens.length === b.covens.length &&
    a.covens.every((v, i) => v === b.covens[i])
  );
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

// Simple debounce hook: returns a debounced value with a ms delay.
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
