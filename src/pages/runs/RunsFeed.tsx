import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { keeperApi, type VoyageStatus, type PushRunStatus, type ErrandStatus } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import { EMPTY_DATE_RANGE, inDateRange, type DateRange } from './dateRange';
import { DateRangeFilter } from './DateRangeFilter';
import styles from '../common.module.css';

// Unified /runs feed — UNION-view всех run-типов в одном списке.
//
// Источники (мержатся client-side по created_at/started_at DESC):
//   PRIMARY  — /v1/voyages (kind=scenario + kind=command, ADR-043 S5).
//   PERMANENT — /v1/push-runs, /v1/errands (не deprecate-ятся).
//
// Каждый endpoint опционален: 404/501 → тихо пропускается. Polling 5s при наличии
// running-прогонов.

type RunType = 'voyage-scenario' | 'voyage-command' | 'push' | 'errand';

// Порядок отображения типов прогонов в шапке фида.
const TYPE_ORDER: RunType[] = ['voyage-scenario', 'voyage-command', 'push', 'errand'];

interface FeedRow {
  type: RunType;
  id: string;
  to: string;
  target: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
}

// Объединённый набор терминальных статусов всех run-типов (Voyage | Push | Errand).
// satisfies: каждый статус должен присутствовать хотя бы в одном из трёх типов —
// это не полный набор, а явное пересечение; при расширении enum в backend
// tsc не сломается сам (новый статус добавляется сюда вручную после проверки семантики).
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

// Voyage → /voyages/:id; Push → /push-runs/:id; Errand → /errands/:id.
function detailPath(type: RunType, id: string): string {
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

// 404/501 → фича не задеплоена, секцию пропускаем (не показываем как ошибку).
function isOptionalMiss(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

const LIMIT = 50;

// Унифицированные статус-группы для multi-select-фильтра /runs. Каждая группа
// матчит набор конкретных статусов разных run-типов (success ↔ succeeded,
// running = любой non-terminal). Пустой набор = без фильтра по статусу.
type StatusGroup = 'success' | 'failed' | 'running' | 'cancelled';
const STATUS_GROUP_ORDER: StatusGroup[] = ['success', 'failed', 'running', 'cancelled'];
const STATUS_GROUP_MATCH: Record<StatusGroup, (status: string) => boolean> = {
  success: (s) => s === 'success' || s === 'succeeded',
  failed: (s) => s === 'failed' || s === 'partial_failed' || s === 'timed_out' || s === 'module_not_allowed',
  running: (s) => isRunning(s),
  cancelled: (s) => s === 'cancelled',
};

export function RunsFeed() {
  const { t } = useTranslation();

  function typeLabel(type: RunType): string {
    switch (type) {
      case 'voyage-scenario': return t('runhistory:voyageScenarioTypeLabel');
      case 'voyage-command': return t('runhistory:voyageCommandTypeLabel');
      case 'push': return 'Push';
      case 'errand': return 'Errand';
    }
  }
  const [typeSet, setTypeSet] = useState<Set<RunType>>(new Set());
  const [statusSet, setStatusSet] = useState<Set<StatusGroup>>(new Set());
  // Клиентский фильтр по диапазону дат старта (см. dateRange.ts) — поверх
  // загруженной страницы, не серверный.
  const [dateRange, setDateRange] = useState<DateRange>(EMPTY_DATE_RANGE);

  // PRIMARY: /v1/voyages (ADR-043 S5). Polling 5s при running.
  const voyagesQ = useQuery({
    queryKey: ['runs-feed', 'voyages'],
    queryFn: () => keeperApi.voyages.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((v) => isRunning(v.status)) ? 5000 : false) : false,
    retry: false,
  });

  // PERMANENT: push-runs + errands (не deprecate-ятся).
  const pushQ = useQuery({
    queryKey: ['runs-feed', 'push'],
    queryFn: () => keeperApi.pushRuns.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((p) => isRunning(p.status)) ? 5000 : false) : false,
    retry: false,
  });
  const errandsQ = useQuery({
    queryKey: ['runs-feed', 'errands'],
    queryFn: () => keeperApi.errands.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? ((q.state.data.items ?? []).some((e) => isRunning(e.status)) ? 5000 : false) : false,
    retry: false,
  });

  // Жёсткие ошибки (не 404/501) — собираем для отображения; optional-miss молчим.
  const errors: string[] = [];
  for (const [label, q] of [
    ['Voyages', voyagesQ],
    ['Push runs', pushQ],
    ['Errands', errandsQ],
  ] as const) {
    if (q.error && !isOptionalMiss(q.error)) {
      errors.push(
        q.error instanceof ApiError
          ? t('runhistory:feedSectionError', { label, status: q.error.status })
          : `${label}: ${String(q.error)}`,
      );
    }
  }

  const allRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];

    // PRIMARY: Voyages.
    for (const v of voyagesQ.data?.items ?? []) {
      const type: RunType = v.kind === 'scenario' ? 'voyage-scenario' : 'voyage-command';
      const target =
        v.kind === 'scenario'
          ? (v.scenario_name ?? v.voyage_id)
          : (v.module ?? v.voyage_id);
      rows.push({
        type,
        id: v.voyage_id,
        to: detailPath(type, v.voyage_id),
        target,
        status: v.status,
        startedAt: v.started_at ?? v.created_at,
        finishedAt: v.finished_at,
      });
    }

    // PERMANENT: push-runs.
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
    // PERMANENT: errands.
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

    // created_at/started_at DESC (отсутствующий → в конец).
    rows.sort((a, b) => {
      const ta = a.startedAt ? Date.parse(a.startedAt) : 0;
      const tb = b.startedAt ? Date.parse(b.startedAt) : 0;
      return tb - ta;
    });
    return rows;
  }, [voyagesQ.data, pushQ.data, errandsQ.data]);

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      if (typeSet.size > 0 && !typeSet.has(r.type)) return false;
      if (statusSet.size > 0) {
        // OR между выбранными группами.
        const ok = Array.from(statusSet).some((g) => STATUS_GROUP_MATCH[g](r.status));
        if (!ok) return false;
      }
      // Клиентский диапазон дат по started_at.
      if (!inDateRange(r.startedAt, dateRange)) return false;
      return true;
    });
  }, [allRows, typeSet, statusSet, dateRange]);

  const anyLoading = voyagesQ.isLoading || pushQ.isLoading || errandsQ.isLoading;

  function toggleType(rt: RunType) {
    setTypeSet((prev) => {
      const next = new Set(prev);
      if (next.has(rt)) next.delete(rt);
      else next.add(rt);
      return next;
    });
  }

  function toggleStatus(g: StatusGroup) {
    setStatusSet((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

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
            {TYPE_ORDER.map((rt) => {
              const active = typeSet.has(rt);
              return (
                <button
                  key={rt}
                  type="button"
                  onClick={() => toggleType(rt)}
                  aria-pressed={active}
                  data-testid={`runs-type-filter-${rt}`}
                  style={chipStyle(active)}
                >
                  {typeLabel(rt)}
                </button>
              );
            })}
          </div>
        </div>
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
      </div>

      {errors.length > 0 ? (
        <div className={styles.errorBox}>{errors.join(' · ')}</div>
      ) : null}

      {anyLoading && allRows.length === 0 ? <div className={styles.loading}>{t('loading')}</div> : null}

      {!anyLoading && filtered.length === 0 ? (
        <div className={styles.empty}>
          {allRows.length === 0 ? (
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

      {filtered.length > 0 ? (
        <table className={styles.table} data-testid="runs-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>ID</th>
              <th>Target</th>
              <th>Status</th>
              <th>Started</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.type}:${r.id}`} data-testid={`runs-row-${r.id}`}>
                <td>
                  <Badge tone="info">{typeLabel(r.type)}</Badge>
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
    </div>
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
