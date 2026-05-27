import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  keeperApi,
  type PushRunStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { pushStatusTone } from './status';
import styles from '../common.module.css';

const STATUSES: PushRunStatus[] = [
  'pending',
  'running',
  'success',
  'partial_failed',
  'failed',
  'cancelled',
];

function relative(ts: string | undefined): string {
  if (!ts) return '—';
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

export function PushRunsList() {
  const [sshProvider, setSshProvider] = useState('');
  const [statusSet, setStatusSet] = useState<Set<PushRunStatus>>(new Set());
  const [offset, setOffset] = useState(0);

  const limit = 50;
  const statuses = statusSet.size > 0 ? Array.from(statusSet) : undefined;

  const q = useQuery({
    queryKey: ['pushRuns.list', { sshProvider, statuses, offset }],
    queryFn: () =>
      keeperApi.pushRuns.list({
        ssh_provider: sshProvider || undefined,
        status: statuses,
        offset,
        limit,
      }),
  });

  const items = q.data?.items ?? [];
  const totalRuns = q.data?.total ?? 0;

  function toggleStatus(s: PushRunStatus) {
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
            <Send size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Push runs
          </h1>
          <div className={styles.crumbs}>история SSH-прогонов</div>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>SSH provider</div>
          <input
            type="text"
            value={sshProvider}
            onChange={(e) => {
              setSshProvider(e.target.value);
              setOffset(0);
            }}
            placeholder="default"
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
        <div className={styles.empty}>Push-прогонов под фильтр не найдено.</div>
      ) : null}

      {items.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Apply ID</th>
                <th>Destiny</th>
                <th>SSH provider</th>
                <th>Status</th>
                <th>Targets</th>
                <th>Success</th>
                <th>Failed</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const total = p.summary_counts?.total ?? p.inventory_sids.length;
                const ok = p.summary_counts?.success_count ?? '—';
                const failed = p.summary_counts?.fail_count ?? '—';
                return (
                  <tr key={p.apply_id}>
                    <td>
                      <Link to={`/push-runs/${encodeURIComponent(p.apply_id)}`} title={p.apply_id}>
                        {p.apply_id.slice(0, 10)}…
                      </Link>
                    </td>
                    <td className="mono">{p.destiny_ref}</td>
                    <td className="mono">{p.ssh_provider || 'routing'}</td>
                    <td>
                      <Badge tone={pushStatusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="mono">{total}</td>
                    <td className="mono">{ok}</td>
                    <td className="mono">{failed}</td>
                    <td className="mono" title={p.started_at}>
                      {relative(p.started_at)}
                    </td>
                  </tr>
                );
              })}
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
              {offset + 1}–{offset + items.length} of {totalRuns}
            </span>
            <button
              disabled={offset + limit >= totalRuns}
              onClick={() => setOffset(offset + limit)}
              style={pagerStyle(offset + limit >= totalRuns)}
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
