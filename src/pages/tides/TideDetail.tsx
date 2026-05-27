import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Waves } from 'lucide-react';
import {
  keeperApi,
  type Tide,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { tideStatusTone } from './status';
import styles from '../common.module.css';

const NON_TERMINAL: ReadonlySet<string> = new Set(['pending', 'running']);

function surgeTerminalTone(t: string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (t) {
    case 'success':
    case 'succeeded':
      return 'ok';
    case 'failed':
      return 'danger';
    case 'partial':
    case 'partial_failed':
      return 'warn';
    case 'cancelled':
      return 'muted';
    case 'orphaned':
    case 'no_match':
      return 'muted';
    default:
      return 'info';
  }
}

function progressPct(t: Tide): number {
  if (!t.total_surges || t.total_surges <= 0) return 0;
  const done = Math.max(0, Math.min(t.current_surge_index, t.total_surges));
  return Math.round((done / t.total_surges) * 100);
}

export function TideDetail() {
  const { id = '' } = useParams<{ id: string }>();

  const q = useQuery({
    queryKey: ['tide.get', id],
    queryFn: () => keeperApi.tides.get(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as Tide | undefined;
      if (!data) return 3000;
      return NON_TERMINAL.has(data.status) ? 3000 : false;
    },
  });

  if (q.isLoading && !q.data) return <div className={styles.loading}>Загружаем…</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
      </div>
    );
  }
  const tide = q.data;
  if (!tide) return <div className={styles.empty}>Tide не найден.</div>;

  const pct = progressPct(tide);
  const surges = tide.summary?.surges ?? [];

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/tides">tides</Link> / <span className="mono">{id}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Waves size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              <span className="mono" style={{ fontSize: 18 }}>{id}</span>
            </h1>
          </div>
          <div>
            <Badge tone={tideStatusTone(tide.status)}>{tide.status}</Badge>
          </div>
        </div>
      </div>

      <section className={styles.section} aria-label="Tide meta">
        <div className={styles.meta}>
          <span className={styles.metaKey}>incarnation</span>
          <span className={styles.metaVal}>
            <Link to={`/incarnations/${encodeURIComponent(tide.incarnation_name)}`}>
              {tide.incarnation_name}
            </Link>
          </span>
          <span className={styles.metaKey}>scenario</span>
          <span className={styles.metaVal}>{tide.scenario_name}</span>
          <span className={styles.metaKey}>scope_size</span>
          <span className={styles.metaVal}>{tide.scope_size}</span>
          <span className={styles.metaKey}>wave (surge_size)</span>
          <span className={styles.metaVal}>{tide.surge_size}</span>
          <span className={styles.metaKey}>failure_policy</span>
          <span className={styles.metaVal}>{tide.on_surge_failure}</span>
          {tide.concurrency_override !== undefined ? (
            <>
              <span className={styles.metaKey}>concurrency_override</span>
              <span className={styles.metaVal}>{tide.concurrency_override}</span>
            </>
          ) : null}
          {tide.target_coven_override && tide.target_coven_override.length > 0 ? (
            <>
              <span className={styles.metaKey}>target.coven</span>
              <span className={styles.metaVal}>{tide.target_coven_override.join(', ')}</span>
            </>
          ) : null}
          {tide.target_where_override ? (
            <>
              <span className={styles.metaKey}>target.where</span>
              <span className={styles.metaVal}>{tide.target_where_override}</span>
            </>
          ) : null}
          <span className={styles.metaKey}>started_by</span>
          <span className={styles.metaVal}>{tide.started_by_aid}</span>
          <span className={styles.metaKey}>started_at</span>
          <span className={styles.metaVal}>{tide.started_at}</span>
          {tide.finished_at ? (
            <>
              <span className={styles.metaKey}>finished_at</span>
              <span className={styles.metaVal}>{tide.finished_at}</span>
            </>
          ) : null}
          {tide.current_apply_id ? (
            <>
              <span className={styles.metaKey}>current_apply</span>
              <span className={styles.metaVal}>{tide.current_apply_id}</span>
            </>
          ) : null}
          <span className={styles.metaKey}>attempt</span>
          <span className={styles.metaVal}>{tide.attempt}</span>
        </div>
      </section>

      <section className={styles.section} aria-label="Tide progress">
        <h2 className={styles.sectionTitle}>
          Прогресс: Surge {tide.current_surge_index} / {tide.total_surges}
        </h2>
        <div aria-label="progress" style={progressOuter}>
          <div style={{ ...progressInner, width: `${pct}%` }} />
        </div>
        <div className={styles.metaKey}>{pct}%</div>
      </section>

      <section className={styles.section} aria-label="Surge timeline">
        <h2 className={styles.sectionTitle}>Surges</h2>
        {surges.length === 0 ? (
          <div className={styles.empty}>
            {NON_TERMINAL.has(tide.status)
              ? 'Surge-волны появятся по мере прохождения.'
              : 'Surge-снимков нет (orchestrator не записал summary).'}
          </div>
        ) : (
          <div className={styles.timeline}>
            {surges.map((s) => (
              <div key={`${s.surge_index}-${s.apply_id}`} className={styles.timelineItem}>
                <div className={styles.timelineHead}>
                  <span>
                    Surge #{s.surge_index} ·{' '}
                    <Badge tone={surgeTerminalTone(s.terminal)}>{s.terminal}</Badge>
                  </span>
                  <span>{s.started_at} → {s.finished_at}</span>
                </div>
                <div className="mono" style={{ fontSize: 12.5 }}>
                  apply: {s.apply_id}
                  {s.failed_souls !== undefined && s.failed_souls > 0
                    ? ` · failed_souls=${s.failed_souls}`
                    : ''}
                </div>
                {s.state_commit_error ? (
                  <div className={styles.errorBox}>
                    state_commit_error: {s.state_commit_error}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const progressOuter = {
  height: 8,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  overflow: 'hidden',
} as const;

const progressInner = {
  height: '100%',
  background: 'var(--accent)',
  transition: 'width 0.3s ease',
} as const;
