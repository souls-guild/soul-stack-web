import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  keeperApi,
  type ErrandRunStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { errandRunStatusTone, ERRAND_RUN_TERMINAL } from './status';
import styles from '../common.module.css';

const STATUSES: ErrandRunStatus[] = [
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

function parseCsv(input: string): string[] {
  return input.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
}

export function ErrandRunsList() {
  const { t } = useTranslation();
  const [moduleCsv, setModuleCsv] = useState('');
  const [statusSet, setStatusSet] = useState<Set<ErrandRunStatus>>(new Set());
  const [offset, setOffset] = useState(0);

  const limit = 50;
  const statuses = statusSet.size > 0 ? Array.from(statusSet) : undefined;
  const modules = parseCsv(moduleCsv);

  const q = useQuery({
    queryKey: ['errandRuns.list', { statuses, modules, offset }],
    queryFn: () =>
      keeperApi.errandRuns.list({
        status: statuses,
        module: modules.length ? modules : undefined,
        offset,
        limit,
      }),
    // Polling 5s, пока в выборке есть non-terminal записи.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasRunning = data.items.some((it) => !ERRAND_RUN_TERMINAL.has(it.status));
      return hasRunning ? 5000 : false;
    },
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  function toggleStatus(s: ErrandRunStatus) {
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
            <Terminal size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Command runs
          </h1>
          <div className={styles.crumbs}>{t('runhistory:errandRunsCrumbs')}</div>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>{t('runhistory:filterModuleLabel')}</div>
          <input
            type="text"
            value={moduleCsv}
            onChange={(e) => {
              setModuleCsv(e.target.value);
              setOffset(0);
            }}
            placeholder="core.cmd.shell, core.exec.run"
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

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>
          {t('runhistory:noErrandRunsFound')}{' '}
          <Link to="/run" style={{ color: 'var(--accent)' }}>
            {t('runhistory:errandsNotFoundRunNew')}
          </Link>
          .
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Errand run ID</th>
                <th>Module</th>
                <th>Target</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.errand_run_id}>
                  <td>
                    <Link
                      to={`/errand-runs/${encodeURIComponent(r.errand_run_id)}`}
                      title={r.errand_run_id}
                    >
                      {r.errand_run_id.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="mono">{r.module}</td>
                  <td className="mono" title={r.target_preview ?? ''}>
                    {r.target_preview ?? '—'}
                  </td>
                  <td className="mono">{r.scope_size}</td>
                  <td>
                    <Badge tone={errandRunStatusTone(r.status)}>{r.status}</Badge>
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
  minWidth: 260,
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
