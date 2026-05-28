import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { tideStatusTone } from '../tides/status';
import { pushStatusTone } from '../pushRuns/status';
import { errandRunStatusTone } from '../errandRuns/status';
import styles from '../common.module.css';

// Unified /runs feed (W2) — UNION-view всех run-типов (Tide / Push / Errand-run /
// Errand) в одном списке. Каждый тип имеет свой list-endpoint; здесь они
// мержатся клиент-сайд по started_at DESC. Фильтр по типу (multi-chip) +
// статусу (свободный exact-match). Polling 5s, пока в выборке есть running.
//
// Каждый list-endpoint опционален: на 404/501 (старый Keeper, или фича не
// задеплоена) соответствующая секция тихо пропускается, остальные показываются.
// Это сводный read-only вход; per-type страницы (/tides, /push-runs, ...)
// остаются для детальной фильтрации/пагинации.

type RunType = 'tide' | 'push' | 'errand-run' | 'errand';

const TYPE_LABEL: Record<RunType, string> = {
  tide: 'Tide',
  push: 'Push',
  'errand-run': 'Errand-run',
  errand: 'Errand',
};

const TYPE_ORDER: RunType[] = ['tide', 'push', 'errand-run', 'errand'];

interface FeedRow {
  type: RunType;
  id: string;
  to: string;
  target: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
}

const TERMINAL: ReadonlySet<string> = new Set([
  'success',
  'succeeded',
  'partial_failed',
  'failed',
  'cancelled',
  'timed_out',
  'module_not_allowed',
]);

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

function statusTone(type: RunType, status: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (type) {
    case 'tide':
      return tideStatusTone(status);
    case 'push':
      return pushStatusTone(status);
    case 'errand-run':
      return errandRunStatusTone(status);
    case 'errand':
      // Errand single — те же тоны, что push (success/failed/cancelled/...).
      return pushStatusTone(status === 'timed_out' || status === 'module_not_allowed' ? 'failed' : status);
  }
}

// Tide → /tides/:id, Push → /push-runs/:id, ErrandRun → /errand-runs/:id,
// Errand → /errands/:id.
function detailPath(type: RunType, id: string): string {
  const enc = encodeURIComponent(id);
  switch (type) {
    case 'tide':
      return `/tides/${enc}`;
    case 'push':
      return `/push-runs/${enc}`;
    case 'errand-run':
      return `/errand-runs/${enc}`;
    case 'errand':
      return `/errands/${enc}`;
  }
}

// 404/501 → фича не задеплоена, секцию пропускаем (не показываем как ошибку).
function isOptionalMiss(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

const LIMIT = 50;

export function RunsFeed() {
  const [typeSet, setTypeSet] = useState<Set<RunType>>(new Set());
  const [statusFilter, setStatusFilter] = useState('');

  // 4 параллельных list-запроса. Polling 5s, если в выборке есть running.
  const tidesQ = useQuery({
    queryKey: ['runs-feed', 'tides'],
    queryFn: () => keeperApi.tides.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? (q.state.data.items.some((t) => isRunning(t.status)) ? 5000 : false) : false,
    retry: false,
  });
  const pushQ = useQuery({
    queryKey: ['runs-feed', 'push'],
    queryFn: () => keeperApi.pushRuns.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? (q.state.data.items.some((p) => isRunning(p.status)) ? 5000 : false) : false,
    retry: false,
  });
  const errandRunsQ = useQuery({
    queryKey: ['runs-feed', 'errand-runs'],
    queryFn: () => keeperApi.errandRuns.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? (q.state.data.items.some((e) => isRunning(e.status)) ? 5000 : false) : false,
    retry: false,
  });
  const errandsQ = useQuery({
    queryKey: ['runs-feed', 'errands'],
    queryFn: () => keeperApi.errands.list({ limit: LIMIT }),
    refetchInterval: (q) =>
      q.state.data ? (q.state.data.items.some((e) => isRunning(e.status)) ? 5000 : false) : false,
    retry: false,
  });

  // Жёсткие ошибки (не 404/501) — собираем для отображения; optional-miss молчим.
  const errors: string[] = [];
  for (const [label, q] of [
    ['Tides', tidesQ],
    ['Push runs', pushQ],
    ['Errand runs', errandRunsQ],
    ['Errands', errandsQ],
  ] as const) {
    if (q.error && !isOptionalMiss(q.error)) {
      errors.push(
        `${label}: ${q.error instanceof ApiError ? `ошибка ${q.error.status}` : String(q.error)}`,
      );
    }
  }

  const allRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];

    for (const t of tidesQ.data?.items ?? []) {
      rows.push({
        type: 'tide',
        id: t.tide_id,
        to: detailPath('tide', t.tide_id),
        target: `${t.incarnation_name} · ${t.scenario_name}`,
        status: t.status,
        startedAt: t.started_at,
        finishedAt: t.finished_at,
      });
    }
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
    for (const e of errandRunsQ.data?.items ?? []) {
      rows.push({
        type: 'errand-run',
        id: e.errand_run_id,
        to: detailPath('errand-run', e.errand_run_id),
        target: e.target_preview ?? e.module,
        status: e.status,
        startedAt: e.started_at,
        finishedAt: e.finished_at,
      });
    }
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

    // started_at DESC (отсутствующий started_at — в конец).
    rows.sort((a, b) => {
      const ta = a.startedAt ? Date.parse(a.startedAt) : 0;
      const tb = b.startedAt ? Date.parse(b.startedAt) : 0;
      return tb - ta;
    });
    return rows;
  }, [tidesQ.data, pushQ.data, errandRunsQ.data, errandsQ.data]);

  const filtered = useMemo(() => {
    const statusNeedle = statusFilter.trim().toLowerCase();
    return allRows.filter((r) => {
      if (typeSet.size > 0 && !typeSet.has(r.type)) return false;
      if (statusNeedle && !r.status.toLowerCase().includes(statusNeedle)) return false;
      return true;
    });
  }, [allRows, typeSet, statusFilter]);

  const anyLoading = tidesQ.isLoading || pushQ.isLoading || errandRunsQ.isLoading || errandsQ.isLoading;

  function toggleType(t: RunType) {
    setTypeSet((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
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
          <div className={styles.crumbs}>сводный feed всех прогонов (Tide / Push / Errand-run / Errand)</div>
        </div>
      </div>

      <div className={styles.filters}>
        <div>
          <div className={styles.metaKey}>Type</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
            {TYPE_ORDER.map((t) => {
              const active = typeSet.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={active}
                  style={chipStyle(active)}
                >
                  {TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>
        <label>
          <div className={styles.metaKey}>Status (substring)</div>
          <input
            type="text"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            placeholder="running / failed / succeeded…"
            style={inputStyle}
          />
        </label>
      </div>

      {errors.length > 0 ? (
        <div className={styles.errorBox}>{errors.join(' · ')}</div>
      ) : null}

      {anyLoading && allRows.length === 0 ? <div className={styles.loading}>Загружаем…</div> : null}

      {!anyLoading && filtered.length === 0 ? (
        <div className={styles.empty}>
          {allRows.length === 0 ? (
            <>
              Ещё не было прогонов.{' '}
              <Link to="/run" style={{ color: 'var(--accent)' }}>
                Запустить
              </Link>
              .
            </>
          ) : (
            'Под выбранный фильтр прогонов не найдено.'
          )}
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <table className={styles.table}>
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
              <tr key={`${r.type}:${r.id}`}>
                <td>
                  <Badge tone="info">{TYPE_LABEL[r.type]}</Badge>
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
                  <Badge tone={statusTone(r.type, r.status)}>{r.status}</Badge>
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

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
  minWidth: 240,
} as const;

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
