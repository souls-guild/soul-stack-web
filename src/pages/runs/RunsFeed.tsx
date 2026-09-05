import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  keeperApi,
  type VoyageStatus,
  type PushRunStatus,
  type ErrandStatus,
  type RunStatus,
  type RunsStatsBucket,
  type RunsListReply,
  type RunsStatsReply,
  type GlobalRunEntry,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Pager } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import { entityCaption } from '../../components/entityCaption';
import { EMPTY_DATE_RANGE, inDateRange, hasDateRange, toServerRange, type DateRange } from './dateRange';
import { DateRangeFilter } from './DateRangeFilter';
import styles from '../common.module.css';

// Unified /runs page (ADR-069 part B2): segment filter by run type + column
// sorting. Two table modes:
//   union (All/Voyage/Push/Errand) — client-side union of sources, CLIENT-SIDE sort.
//   scenario (Scenario) — apply_run via GET /v1/runs, SERVER-SIDE sort+pagination+stats.
// Each endpoint is optional: 404/501 -> silently skipped. Polling 5s while running.

type Segment = 'all' | 'scenario' | 'voyage' | 'push' | 'errand';

// Segment labels are localized; the run-type names that are dictionary entities
// (Voyage / Push / Errand) resolve to the same English word in every locale.
const SEGMENTS: { id: Segment; labelKey: string }[] = [
  { id: 'all', labelKey: 'all' },
  { id: 'scenario', labelKey: 'runhistory:segScenario' },
  { id: 'voyage', labelKey: 'runhistory:segVoyage' },
  { id: 'push', labelKey: 'runhistory:segPush' },
  { id: 'errand', labelKey: 'runhistory:segErrand' },
];

type RunType = 'scenario' | 'voyage-scenario' | 'voyage-command' | 'push' | 'errand';

interface FeedRow {
  type: RunType;
  id: string;
  to: string;
  target: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
}

// The Type badge of a union row maps onto the segment taxonomy (Scenario/Voyage/Push/Errand),
// so the Type column matches the segment selector. The voyage scenario/command nuance is visible in Target.
// Returns an i18n key — the same keys the segment selector uses, so both stay in step.
function typeLabelKey(type: RunType): string {
  switch (type) {
    case 'scenario':
      return 'runhistory:segScenario';
    case 'voyage-scenario':
    case 'voyage-command':
      return 'runhistory:segVoyage';
    case 'push':
      return 'runhistory:segPush';
    case 'errand':
      return 'runhistory:segErrand';
  }
}

// Combined set of terminal statuses across all run types (Voyage | Push | Errand).
type AnyRunStatus = VoyageStatus | PushRunStatus | ErrandStatus;
const TERMINAL_STATUSES = [
  'success',
  'succeeded',
  'partial_failed',
  'failed',
  'cancelled',
  'timed_out',
  'module_not_allowed',
] as const satisfies readonly AnyRunStatus[];
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

function isRunning(status: string): boolean {
  return !TERMINAL.has(status);
}

function relative(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

function tparse(ts: string | undefined): number {
  if (!ts) return 0;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
}

// Voyage -> /voyages/:id; Push -> /push-runs/:id; Errand -> /errands/:id.
function detailPath(type: Exclude<RunType, 'scenario'>, id: string): string {
  const enc = encodeURIComponent(id);
  switch (type) {
    case 'voyage-scenario':
    case 'voyage-command':
      return `/voyages/${enc}`;
    case 'push':
      return `/push-runs/${enc}`;
    case 'errand':
      return `/errands/${enc}`;
  }
}

// 404/501 -> feature not deployed, skip the section (don't show as an error).
function isOptionalMiss(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

const LIMIT = 50;

// Unified status groups for the multi-select filter. success <-> succeeded,
// running = any non-terminal. Empty set = no status filter.
type StatusGroup = 'success' | 'failed' | 'running' | 'cancelled';
const STATUS_GROUP_ORDER: StatusGroup[] = ['success', 'failed', 'running', 'cancelled'];
const STATUS_GROUP_MATCH: Record<StatusGroup, (status: string) => boolean> = {
  success: (s) => s === 'success' || s === 'succeeded',
  failed: (s) => s === 'failed' || s === 'partial_failed' || s === 'timed_out' || s === 'module_not_allowed',
  running: (s) => isRunning(s),
  cancelled: (s) => s === 'cancelled',
};

// --- Union client-sort (SoulsList pattern) with secondary tie-break by id (determinism). ---
type UnionSortKey = 'type' | 'id' | 'target' | 'status' | 'started' | 'finished';
type SortDir = 'asc' | 'desc';

function compareUnion(a: FeedRow, b: FeedRow, key: UnionSortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case 'type':
      cmp = a.type.localeCompare(b.type);
      break;
    case 'id':
      cmp = a.id.localeCompare(b.id);
      break;
    case 'target':
      cmp = a.target.localeCompare(b.target);
      break;
    case 'status':
      cmp = a.status.localeCompare(b.status);
      break;
    case 'started':
      cmp = tparse(a.startedAt) - tparse(b.startedAt);
      break;
    case 'finished':
      cmp = tparse(a.finishedAt) - tparse(b.finishedAt);
      break;
  }
  const primary = dir === 'asc' ? cmp : -cmp;
  if (primary !== 0) return primary;
  return a.id.localeCompare(b.id); // deterministic tie-break (dir-independent)
}

// --- Scenario server-sort whitelist (matches backend GET /v1/runs). ---
type ScenSortKey = 'incarnation' | 'service' | 'scenario' | 'status' | 'started_at' | 'finished_at';

type AriaSort = 'ascending' | 'descending' | 'none';
function ariaSortOf(active: boolean, dir: SortDir): AriaSort {
  if (!active) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}
function sortGlyph(active: boolean, dir: SortDir): string {
  if (!active) return '';
  return dir === 'asc' ? ' ▲' : ' ▼';
}

// Aggregate run statuses (Scenario stats); satisfies catches drift when the enum expands.
const SCEN_STATUSES = ['applying', 'success', 'failed', 'cancelled'] as const satisfies readonly RunStatus[];

// Client-side text search over already-loaded union rows (case-insensitive substring
// over id/target/status). Client-only — union is already "first N of each type" anyway.
function matchesUnionSearch(row: FeedRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.id.toLowerCase().includes(needle) ||
    row.target.toLowerCase().includes(needle) ||
    row.status.toLowerCase().includes(needle)
  );
}

function StatBox({
  label,
  bucketKey,
  all,
  last24h,
  loading,
}: {
  label: string;
  bucketKey: keyof RunsStatsBucket;
  all?: RunsStatsBucket;
  last24h?: RunsStatsBucket;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.summaryCard} data-testid={`runs-stat-${bucketKey}`}>
      <span className={styles.summaryCardLabel}>{label}</span>
      <span className={styles.summaryCardValue}>{loading ? '…' : (all?.[bucketKey] ?? 0)}</span>
      <span className={styles.summaryCardHint}>
        {loading ? '…' : t('runhistory:statsLast24h', { n: last24h?.[bucketKey] ?? 0 })}
      </span>
    </div>
  );
}

export function RunsFeed() {
  const { t } = useTranslation();

  const [segment, setSegment] = useState<Segment>('all');
  const [statusSet, setStatusSet] = useState<Set<StatusGroup>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>(EMPTY_DATE_RANGE);

  // union client-sort state.
  const [unionSortKey, setUnionSortKey] = useState<UnionSortKey>('started');
  const [unionSortDir, setUnionSortDir] = useState<SortDir>('desc');
  // Client-side search over already-loaded union rows (NIM-42 PART B).
  const [unionSearch, setUnionSearch] = useState('');

  // scenario server-sort + pagination + SERVER-SIDE filters (incarnation + status).
  // status here is a single-select apply_run status (NOT the union-statusSet): a
  // server-paginated segment must filter server-side or Pager/total will lie.
  const [scenSortKey, setScenSortKey] = useState<ScenSortKey>('started_at');
  const [scenSortDir, setScenSortDir] = useState<SortDir>('desc');
  const [offset, setOffset] = useState(0);
  const [incarnation, setIncarnation] = useState('');
  const [scenarioStatus, setScenarioStatus] = useState<RunStatus | ''>('');
  // NIM-42: server-side Service filter + free-text search q (substring over
  // incarnation/scenario/service/started_by) — both in the query AND queryKey.
  const [scenService, setScenService] = useState('');
  const [scenQuery, setScenQuery] = useState('');
  // NIM-42: server-side started_at range (separate from union dateRange) —
  // converted to started_after/started_before via toServerRange.
  const [scenDateRange, setScenDateRange] = useState<DateRange>(EMPTY_DATE_RANGE);

  const wantVoyage = segment === 'all' || segment === 'voyage';
  const wantPush = segment === 'all' || segment === 'push';
  const wantErrand = segment === 'all' || segment === 'errand';
  const wantScenarioUnion = segment === 'all'; // apply_run as a 4th source — only in All.
  const isScenario = segment === 'scenario';

  const voyagesQ = useQuery({
    queryKey: ['runs-feed', 'voyages'],
    queryFn: () => keeperApi.voyages.list({ limit: LIMIT }),
    enabled: wantVoyage,
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((v) => isRunning(v.status)) ? 5000 : false) : false,
    retry: false,
  });
  const pushQ = useQuery({
    queryKey: ['runs-feed', 'push'],
    queryFn: () => keeperApi.pushRuns.list({ limit: LIMIT }),
    enabled: wantPush,
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((p) => isRunning(p.status)) ? 5000 : false) : false,
    retry: false,
  });
  const errandsQ = useQuery({
    queryKey: ['runs-feed', 'errands'],
    queryFn: () => keeperApi.errands.list({ limit: LIMIT }),
    enabled: wantErrand,
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((e) => isRunning(e.status)) ? 5000 : false) : false,
    retry: false,
  });
  // 4th union source (All): first N scenario apply_run, default server sort.
  const applyUnionQ = useQuery({
    queryKey: ['runs-feed', 'apply-union'],
    queryFn: () => keeperApi.runs.list({ limit: LIMIT }),
    enabled: wantScenarioUnion,
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((r) => r.status === 'applying') ? 5000 : false) : false,
    retry: false,
  });

  // Scenario mode: server-side sort + SERVER-SIDE filter (status/incarnation) + pagination.
  // Everything (sort/sort_dir/status/incarnation/offset) is in the query AND queryKey.
  const scenServerRange = toServerRange(scenDateRange);
  const scenarioQ = useQuery({
    queryKey: [
      'runs.list',
      {
        incarnation,
        service: scenService,
        q: scenQuery,
        status: scenarioStatus,
        started_after: scenServerRange.started_after,
        started_before: scenServerRange.started_before,
        offset,
        sort: scenSortKey,
        sort_dir: scenSortDir,
      },
    ],
    queryFn: () =>
      keeperApi.runs.list({
        incarnation: incarnation || undefined,
        service: scenService || undefined,
        q: scenQuery || undefined,
        status: scenarioStatus || undefined,
        started_after: scenServerRange.started_after,
        started_before: scenServerRange.started_before,
        offset,
        limit: LIMIT,
        sort: scenSortKey,
        sort_dir: scenSortDir,
      }),
    enabled: isScenario,
    retry: false,
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((r) => r.status === 'applying') ? 5000 : false,
  });
  const statsQ = useQuery({
    queryKey: ['runs.stats'],
    queryFn: () => keeperApi.runs.stats(),
    enabled: isScenario,
    retry: false,
  });
  // Service catalog for the Service filter (ADR-042 — no hardcode). No catalog/error
  // -> just an empty options list (graceful degradation), no filter-bar crash.
  const servicesQ = useQuery({
    queryKey: ['services', 'list'],
    queryFn: () => keeperApi.services.list(),
    enabled: isScenario,
    retry: false,
  });

  // Hard errors from union sources (not 404/501); optional-miss stays silent.
  const unionErrors: string[] = [];
  for (const [label, q] of [
    ['Voyages', voyagesQ],
    ['Push runs', pushQ],
    ['Errands', errandsQ],
    ['Scenario runs', applyUnionQ],
  ] as const) {
    if (q.error && !isOptionalMiss(q.error)) {
      unionErrors.push(
        q.error instanceof ApiError
          ? t('runhistory:feedSectionError', { label, status: q.error.status })
          : `${label}: ${String(q.error)}`,
      );
    }
  }

  const unionRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];
    if (wantVoyage) {
      for (const v of voyagesQ.data?.items ?? []) {
        const vt: 'voyage-scenario' | 'voyage-command' =
          v.kind === 'scenario' ? 'voyage-scenario' : 'voyage-command';
        const target = v.kind === 'scenario' ? (v.scenario_name ?? v.voyage_id) : (v.module ?? v.voyage_id);
        rows.push({
          type: vt,
          id: v.voyage_id,
          to: detailPath(vt, v.voyage_id),
          target,
          status: v.status,
          startedAt: v.started_at ?? v.created_at,
          finishedAt: v.finished_at,
        });
      }
    }
    if (wantPush) {
      for (const p of pushQ.data?.items ?? []) {
        rows.push({
          type: 'push',
          id: p.apply_id,
          to: detailPath('push', p.apply_id),
          target: p.destiny_ref,
          status: p.status,
          startedAt: p.started_at,
          finishedAt: p.finished_at,
        });
      }
    }
    if (wantErrand) {
      for (const e of errandsQ.data?.items ?? []) {
        rows.push({
          type: 'errand',
          id: e.errand_id,
          to: detailPath('errand', e.errand_id),
          target: `${e.sid} · ${e.module}`,
          status: e.status,
          startedAt: e.started_at,
          finishedAt: e.finished_at,
        });
      }
    }
    if (wantScenarioUnion) {
      for (const r of applyUnionQ.data?.items ?? []) {
        rows.push({
          type: 'scenario',
          id: r.apply_id,
          to: `/incarnations/${encodeURIComponent(r.incarnation)}/runs/${encodeURIComponent(r.apply_id)}`,
          target: `${r.incarnation} · ${r.scenario}`,
          status: r.status,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
        });
      }
    }
    return rows;
  }, [wantVoyage, wantPush, wantErrand, wantScenarioUnion, voyagesQ.data, pushQ.data, errandsQ.data, applyUnionQ.data]);

  // Client filter (status groups + date-range + free-text search over loaded rows)
  // + client-sort union.
  function passesClientFilters(row: FeedRow): boolean {
    if (statusSet.size > 0) {
      const ok = Array.from(statusSet).some((g) => STATUS_GROUP_MATCH[g](row.status));
      if (!ok) return false;
    }
    if (!inDateRange(row.startedAt, dateRange)) return false;
    return matchesUnionSearch(row, unionSearch);
  }

  const unionView = useMemo(() => {
    const filtered = unionRows.filter((r) => passesClientFilters(r));
    return [...filtered].sort((a, b) => compareUnion(a, b, unionSortKey, unionSortDir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unionRows, statusSet, dateRange, unionSearch, unionSortKey, unionSortDir]);

  // Scenario is filtered ONLY server-side (status/incarnation in query) — a client filter
  // would break Pager/total; items are passed through as-is (server already filtered+sorted).
  const scenView = scenarioQ.data?.items ?? [];

  const unionLoading =
    voyagesQ.isLoading || pushQ.isLoading || errandsQ.isLoading || applyUnionQ.isLoading;

  function toggleStatus(g: StatusGroup) {
    setStatusSet((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  function toggleUnionSort(key: UnionSortKey) {
    if (unionSortKey === key) {
      setUnionSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUnionSortKey(key);
      setUnionSortDir(key === 'started' || key === 'finished' ? 'desc' : 'asc');
    }
  }

  // Changing Scenario sort RESETS offset to 0 (server-side pagination).
  function toggleScenSort(key: ScenSortKey) {
    setOffset(0);
    if (scenSortKey === key) {
      setScenSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setScenSortKey(key);
      setScenSortDir(key === 'started_at' || key === 'finished_at' ? 'desc' : 'asc');
    }
  }

  const scenTotal = scenarioQ.data?.total ?? 0;
  const scenHasFilters =
    incarnation !== '' ||
    scenarioStatus !== '' ||
    scenService !== '' ||
    scenQuery !== '' ||
    hasDateRange(scenDateRange);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Activity size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            All runs
          </h1>
          <div className={styles.crumbs}>{t('runhistory:runsFeedCrumbs')}</div>
        </div>
      </div>

      <div className={styles.filters}>
        <div>
          <div className={styles.metaKey}>{t('runhistory:filterTypeLabel')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
            {SEGMENTS.map((seg) => {
              const active = segment === seg.id;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => setSegment(seg.id)}
                  aria-pressed={active}
                  data-testid={`runs-segment-${seg.id}`}
                  style={chipStyle(active)}
                >
                  {t(seg.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
        {isScenario ? (
          <>
            <label>
              <div className={styles.metaKey}>{t('common:colIncarnation')}</div>
              <input
                type="text"
                value={incarnation}
                onChange={(e) => {
                  setIncarnation(e.target.value);
                  setOffset(0);
                }}
                placeholder="redis-prod"
                style={inputStyle}
              />
            </label>
            <label>
              <div className={styles.metaKey}>{t('runhistory:filterStatusLabel')}</div>
              <select
                value={scenarioStatus}
                onChange={(e) => {
                  setScenarioStatus(e.target.value as RunStatus | '');
                  setOffset(0);
                }}
                data-testid="runs-scenario-status-filter"
                style={selectStyle}
              >
                <option value="">{t('all')}</option>
                {SCEN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div className={styles.metaKey}>{t('runhistory:filterServiceLabel')}</div>
              <select
                value={scenService}
                onChange={(e) => {
                  setScenService(e.target.value);
                  setOffset(0);
                }}
                data-testid="runs-scenario-service-filter"
                style={selectStyle}
              >
                <option value="">{t('runhistory:filterServiceAllOption')}</option>
                {/* value is the id the filter is sent as; the text is what the operator reads. */}
                {(servicesQ.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {entityCaption(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div className={styles.metaKey}>{t('search')}</div>
              <input
                type="text"
                value={scenQuery}
                onChange={(e) => {
                  setScenQuery(e.target.value);
                  setOffset(0);
                }}
                placeholder={t('runhistory:scenarioSearchPlaceholder')}
                data-testid="runs-scenario-search-filter"
                style={inputStyle}
              />
            </label>
            <DateRangeFilter
              value={scenDateRange}
              onChange={(r) => {
                setScenDateRange(r);
                setOffset(0);
              }}
              metaKeyClass={styles.metaKey}
            />
          </>
        ) : (
          <>
            <div>
              <div className={styles.metaKey}>{t('runhistory:filterStatusLabel')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
                {STATUS_GROUP_ORDER.map((g) => {
                  const active = statusSet.has(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleStatus(g)}
                      aria-pressed={active}
                      data-testid={`status-filter-${g}`}
                      style={chipStyle(active)}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
            <DateRangeFilter value={dateRange} onChange={setDateRange} metaKeyClass={styles.metaKey} />
            <label>
              <div className={styles.metaKey}>{t('runhistory:unionSearchLabel')}</div>
              <input
                type="text"
                value={unionSearch}
                onChange={(e) => setUnionSearch(e.target.value)}
                placeholder={t('runhistory:unionSearchPlaceholder')}
                data-testid="runs-union-search"
                style={inputStyle}
              />
            </label>
          </>
        )}
      </div>

      {isScenario ? (
        <ScenarioSegment
          statsQ={statsQ}
          scenarioQ={scenarioQ}
          scenView={scenView}
          scenTotal={scenTotal}
          scenHasFilters={scenHasFilters}
          offset={offset}
          onPage={setOffset}
          sortKey={scenSortKey}
          sortDir={scenSortDir}
          onSort={toggleScenSort}
        />
      ) : (
        <UnionSegment
          segment={segment}
          rows={unionView}
          totalRows={unionRows.length}
          loading={unionLoading}
          errors={unionErrors}
          sortKey={unionSortKey}
          sortDir={unionSortDir}
          onSort={toggleUnionSort}
          typeLabelKeyOf={typeLabelKey}
        />
      )}
    </div>
  );
}

// --- union mode (All/Voyage/Push/Errand) ---
function UnionSegment({
  segment,
  rows,
  totalRows,
  loading,
  errors,
  sortKey,
  sortDir,
  onSort,
  typeLabelKeyOf,
}: {
  segment: Segment;
  rows: FeedRow[];
  totalRows: number;
  loading: boolean;
  errors: string[];
  sortKey: UnionSortKey;
  sortDir: SortDir;
  onSort: (k: UnionSortKey) => void;
  typeLabelKeyOf: (t: RunType) => string;
}) {
  const { t } = useTranslation();
  const cols: { key: UnionSortKey; label: string }[] = [
    { key: 'type', label: t('colType') },
    { key: 'id', label: 'ID' },
    { key: 'target', label: t('colTarget') },
    { key: 'status', label: t('colStatus') },
    { key: 'started', label: t('colStarted') },
    { key: 'finished', label: t('colFinished') },
  ];

  return (
    <>
      {errors.length > 0 ? <div className={styles.errorBox}>{errors.join(' · ')}</div> : null}

      {segment === 'all' ? (
        <div className={styles.metaKey} data-testid="runs-first-n">
          {t('runhistory:firstNPerType', { n: LIMIT })}
        </div>
      ) : null}

      {loading && totalRows === 0 ? <div className={styles.loading}>{t('loading')}</div> : null}

      {!loading && rows.length === 0 ? (
        <div className={styles.empty}>
          {totalRows === 0 ? (
            <>
              {t('runhistory:noRunsAtAll')}{' '}
              <Link to="/run" style={{ color: 'var(--accent)' }}>
                {t('runhistory:runAll')}
              </Link>
              .
            </>
          ) : (
            t('runhistory:noRunsForFilter')
          )}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <table className={styles.table} data-testid="runs-table">
          <thead>
            <tr>
              {cols.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th key={c.key} aria-sort={ariaSortOf(active, sortDir)}>
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      data-testid={`runs-sort-${c.key}`}
                      style={sortBtnStyle}
                    >
                      {c.label}
                      {sortGlyph(active, sortDir)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.type}:${r.id}`} data-testid={`runs-row-${r.id}`} data-run-type={r.type}>
                <td>
                  <Badge tone="info">{t(typeLabelKeyOf(r.type))}</Badge>
                </td>
                <td>
                  <Link to={r.to} title={r.id}>
                    {r.id.slice(0, 10)}…
                  </Link>
                </td>
                <td className="mono" title={r.target}>
                  {r.target}
                </td>
                <td>
                  <Badge tone={runStatusTone(r.status)}>{r.status}</Badge>
                </td>
                <td className="mono" title={r.startedAt}>
                  {relative(r.startedAt)}
                </td>
                <td className="mono" title={r.finishedAt}>
                  {r.finishedAt ? relative(r.finishedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

// --- scenario mode (apply_run, server-side sort+pagination+stats) ---
function ScenarioSegment({
  statsQ,
  scenarioQ,
  scenView,
  scenTotal,
  scenHasFilters,
  offset,
  onPage,
  sortKey,
  sortDir,
  onSort,
}: {
  statsQ: UseQueryResult<RunsStatsReply>;
  scenarioQ: UseQueryResult<RunsListReply>;
  scenView: GlobalRunEntry[];
  scenTotal: number;
  scenHasFilters: boolean;
  offset: number;
  onPage: (offset: number) => void;
  sortKey: ScenSortKey;
  sortDir: SortDir;
  onSort: (k: ScenSortKey) => void;
}) {
  const { t } = useTranslation();
  // Sortable columns — whitelist from backend GET /v1/runs (Apply ID / Started by are excluded).

  function ScenTh({ colKey, label }: { colKey: ScenSortKey; label: string }) {
    const active = sortKey === colKey;
    return (
      <th aria-sort={ariaSortOf(active, sortDir)}>
        <button
          type="button"
          onClick={() => onSort(colKey)}
          data-testid={`runs-scen-sort-${colKey}`}
          style={sortBtnStyle}
        >
          {label}
          {sortGlyph(active, sortDir)}
        </button>
      </th>
    );
  }

  return (
    <>
      {statsQ.isError ? null : (
        <section className={styles.summaryGrid} aria-label={t('runhistory:statsSectionAria')} data-testid="runs-stats">
          <StatBox label={t('runhistory:statsTotalLabel')} bucketKey="total" all={statsQ.data?.all} last24h={statsQ.data?.last_24h} loading={statsQ.isLoading} />
          {SCEN_STATUSES.map((s) => (
            <StatBox key={s} label={s} bucketKey={s} all={statsQ.data?.all} last24h={statsQ.data?.last_24h} loading={statsQ.isLoading} />
          ))}
        </section>
      )}

      {scenarioQ.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {scenarioQ.error ? (
        <div className={styles.errorBox}>
          {scenarioQ.error instanceof ApiError
            ? t('errors:generic', { status: scenarioQ.error.status, detail: scenarioQ.error.message })
            : String(scenarioQ.error)}
        </div>
      ) : null}

      {scenarioQ.data && scenView.length === 0 ? (
        <div className={styles.empty}>
          {scenHasFilters ? (
            t('runhistory:noRunsForFilter')
          ) : (
            <>
              {t('runhistory:noRunsAtAll')}{' '}
              <Link to="/run" style={{ color: 'var(--accent)' }}>
                {t('runhistory:runAll')}
              </Link>
              .
            </>
          )}
        </div>
      ) : null}

      {scenView.length > 0 ? (
        <>
          <table className={styles.table} data-testid="runs-scenario-table">
            <thead>
              <tr>
                <th>{t('common:colApplyId')}</th>
                <ScenTh colKey="incarnation" label={t('common:colIncarnation')} />
                <ScenTh colKey="service" label={t('runhistory:filterServiceLabel')} />
                <ScenTh colKey="scenario" label={t('common:colScenario')} />
                <ScenTh colKey="status" label={t('common:colStatus')} />
                <th>{t('colStartedBy')}</th>
                <ScenTh colKey="started_at" label={t('common:colStartedAt')} />
                <ScenTh colKey="finished_at" label={t('common:colFinishedAt')} />
              </tr>
            </thead>
            <tbody>
              {scenView.map((r) => (
                <tr key={r.apply_id} data-testid={`runs-scenario-row-${r.apply_id}`}>
                  <td>
                    <Link
                      to={`/incarnations/${encodeURIComponent(r.incarnation)}/runs/${encodeURIComponent(r.apply_id)}`}
                      title={r.apply_id}
                    >
                      {r.apply_id.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="mono">
                    <Link to={`/incarnations/${encodeURIComponent(r.incarnation)}`}>{r.incarnation}</Link>
                  </td>
                  <td className="mono">{r.service}</td>
                  <td className="mono">{r.scenario}</td>
                  <td>
                    <Badge tone={runStatusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="mono">
                    {r.started_by_aid ? (
                      <Link to={`/archons/${encodeURIComponent(r.started_by_aid)}`}>{r.started_by_aid}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mono" title={r.started_at}>
                    {relative(r.started_at)}
                  </td>
                  <td className="mono" title={r.finished_at}>
                    {r.finished_at ? relative(r.finished_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager offset={offset} limit={LIMIT} total={scenTotal} shown={scenView.length} onChange={onPage} />
        </>
      ) : null}
    </>
  );
}

function chipStyle(active: boolean) {
  return {
    padding: '4px 10px',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))' : 'var(--surface)',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
  } as const;
}

const sortBtnStyle = {
  background: 'transparent',
  border: 0,
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  padding: 0,
} as const;

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
  minWidth: 220,
} as const;

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
} as const;
