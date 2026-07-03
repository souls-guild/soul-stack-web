import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { keeperApi, type RunStatus, type RunsStatsBucket } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Pager } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';

// Глобальный список scenario-прогонов (apply_run, НЕ Voyage) через все инкарнации —
// GET /v1/runs + счётчики GET /v1/runs/stats. Детали прогона — существующий
// RunDetail (/incarnations/:name/runs/:applyId).

// Агрегатные статусы прогона из контракта; satisfies ловит drift при расширении enum.
const STATUSES = ['applying', 'success', 'failed', 'cancelled'] as const satisfies readonly RunStatus[];

const LIMIT = 50;

function relative(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
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

export function IncarnationRunsList() {
  const { t } = useTranslation();
  const [incarnation, setIncarnation] = useState('');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [offset, setOffset] = useState(0);

  const statsQ = useQuery({
    queryKey: ['runs.stats'],
    queryFn: () => keeperApi.runs.stats(),
    retry: false,
  });

  const q = useQuery({
    queryKey: ['runs.list', { status, incarnation, offset }],
    queryFn: () =>
      keeperApi.runs.list({
        status: status || undefined,
        incarnation: incarnation || undefined,
        offset,
        limit: LIMIT,
      }),
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((r) => r.status === 'applying') ? 5000 : false,
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const hasFilters = status !== '' || incarnation !== '';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <History size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Incarnation runs
          </h1>
          <div className={styles.crumbs}>{t('runhistory:incarnationRunsCrumbs')}</div>
        </div>
      </div>

      {/* Счётчики /v1/runs/stats; при ошибке секцию тихо прячем — список живёт сам по себе. */}
      {statsQ.isError ? null : (
        <section className={styles.summaryGrid} aria-label={t('runhistory:statsSectionAria')} data-testid="runs-stats">
          <StatBox label={t('runhistory:statsTotalLabel')} bucketKey="total" all={statsQ.data?.all} last24h={statsQ.data?.last_24h} loading={statsQ.isLoading} />
          {STATUSES.map((s) => (
            <StatBox key={s} label={s} bucketKey={s} all={statsQ.data?.all} last24h={statsQ.data?.last_24h} loading={statsQ.isLoading} />
          ))}
        </section>
      )}

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Incarnation</div>
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
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as RunStatus | '');
              setOffset(0);
            }}
            data-testid="runs-status-filter"
            style={fieldStyle}
          >
            <option value="">{t('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>
          {hasFilters ? (
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

      {items.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Apply ID</th>
                <th>Incarnation</th>
                <th>Scenario</th>
                <th>Status</th>
                <th>Started by</th>
                <th>Started at</th>
                <th>Finished at</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.apply_id}>
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
          <Pager offset={offset} limit={LIMIT} total={total} shown={items.length} onChange={setOffset} />
        </>
      ) : null}
    </div>
  );
}

const fieldStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
} as const;

const inputStyle = {
  ...fieldStyle,
  fontFamily: 'var(--font-mono)',
  minWidth: 220,
} as const;
