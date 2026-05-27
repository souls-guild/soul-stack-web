import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Waves } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  keeperApi,
  type TideStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { tideStatusTone } from './status';
import styles from '../common.module.css';

const STATUSES: TideStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'partial_failed',
  'cancelled',
];

// «3 m ago» / «—» если no value. Raw RFC3339 уезжает в title=…
function relative(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

export function TidesList() {
  const [incarnation, setIncarnation] = useState('');
  const [statusSet, setStatusSet] = useState<Set<TideStatus>>(new Set());
  const [offset, setOffset] = useState(0);

  const limit = 50;
  const statuses = statusSet.size > 0 ? Array.from(statusSet) : undefined;

  const q = useQuery({
    queryKey: ['tides.list', { incarnation, statuses, offset }],
    queryFn: () =>
      keeperApi.tides.list({
        incarnation: incarnation || undefined,
        status: statuses,
        offset,
        limit,
      }),
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  function toggleStatus(s: TideStatus) {
    setStatusSet((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
    setOffset(0);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Waves size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Tides
          </h1>
          <div className={styles.crumbs}>история Tide-прогонов (ADR-040)</div>
        </div>
      </div>

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
            placeholder="redis-prod-eu"
            style={inputStyle}
          />
        </label>
        <div>
          <div className={styles.metaKey}>Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
            {STATUSES.map((s) => {
              const active = statusSet.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  aria-pressed={active}
                  style={chipStyle(active)}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {q.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>Tide-прогонов под фильтр не найдено.</div>
      ) : null}

      {items.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tide ID</th>
                <th>Incarnation</th>
                <th>Scenario</th>
                <th>Status</th>
                <th>Scope</th>
                <th>Wave</th>
                <th>Surge</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.tide_id}>
                  <td>
                    <Link to={`/tides/${encodeURIComponent(t.tide_id)}`} title={t.tide_id}>
                      {t.tide_id.slice(0, 10)}…
                    </Link>
                  </td>
                  <td>
                    <Link to={`/incarnations/${encodeURIComponent(t.incarnation_name)}`}>
                      {t.incarnation_name}
                    </Link>
                  </td>
                  <td className="mono">{t.scenario_name}</td>
                  <td>
                    <Badge tone={tideStatusTone(t.status)}>{t.status}</Badge>
                  </td>
                  <td className="mono">{t.scope_size}</td>
                  <td className="mono">{t.surge_size}</td>
                  <td className="mono">
                    {t.current_surge_index}/{t.total_surges}
                  </td>
                  <td className="mono" title={t.started_at}>
                    {relative(t.started_at)}
                  </td>
                  <td className="mono" title={t.finished_at}>
                    {t.finished_at ? relative(t.finished_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              style={pagerStyle(offset === 0)}
            >
              ← Prev
            </button>
            <span>
              {offset + 1}–{offset + items.length} of {total}
            </span>
            <button
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              style={pagerStyle(offset + limit >= total)}
            >
              Next →
            </button>
          </div>
        </>
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
  minWidth: 220,
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

function pagerStyle(disabled: boolean) {
  return {
    padding: '4px 10px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
  } as const;
}
