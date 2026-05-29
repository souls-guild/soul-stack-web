import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import {
  keeperApi,
  type ErrandStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import styles from '../common.module.css';

const STATUSES: ErrandStatus[] = [
  'running',
  'success',
  'failed',
  'timed_out',
  'cancelled',
  'module_not_allowed',
];

function statusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success':
      return 'ok';
    case 'failed':
    case 'timed_out':
    case 'module_not_allowed':
      return 'danger';
    case 'cancelled':
      return 'muted';
    case 'running':
      return 'info';
    default:
      return 'muted';
  }
}

// CSV (`core.cmd.shell, core.exec.run`) → массив exact-match.
// Multi-value `?module=X&module=Y` server-side OR (openapi commit 157ee27).
function parseModuleCsv(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function ErrandsList() {
  const { t } = useTranslation();
  const [sid, setSid] = useState('');
  const [moduleCsv, setModuleCsv] = useState('');
  const [status, setStatus] = useState<ErrandStatus | ''>('');
  const [startedAfter, setStartedAfter] = useState('');
  const [offset, setOffset] = useState(0);

  const limit = 50;
  const modules = parseModuleCsv(moduleCsv);
  const q = useQuery({
    queryKey: ['errands.list', { sid, status, startedAfter, modules, offset }],
    queryFn: () =>
      keeperApi.errands.list({
        sid: sid || undefined,
        status: status || undefined,
        started_after: startedAfter || undefined,
        module: modules.length ? modules : undefined,
        offset,
        limit,
      }),
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Terminal size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            Errands
          </h1>
          <div className={styles.crumbs}>{t('runhistory:errandsCrumbsBefore')}<Link to="/run?workload=command">{t('runhistory:runWizardLink')}</Link></div>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>SID</div>
          <input
            type="text"
            value={sid}
            onChange={(e) => {
              setSid(e.target.value);
              setOffset(0);
            }}
            placeholder="host01.example.com"
            style={inputStyle}
          />
        </label>
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
            style={{ ...inputStyle, minWidth: 260 }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Status</div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ErrandStatus | '');
              setOffset(0);
            }}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">{t('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>{t('runhistory:filterStartedAfterLabel')}</div>
          <input
            type="text"
            value={startedAfter}
            onChange={(e) => {
              setStartedAfter(e.target.value);
              setOffset(0);
            }}
            placeholder="2026-05-25T00:00:00Z"
            style={inputStyle}
          />
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
          {t('pages:errandsNotFound')}{' '}
          <Link to="/run?workload=command" style={{ color: 'var(--accent)' }}>
            {t('runNewViaWizard')}
          </Link>
          .
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Errand ID</th>
                <th>SID</th>
                <th>Module</th>
                <th>Status</th>
                <th>Exit</th>
                <th>Duration ms</th>
                <th>Started at</th>
                <th>Finished at</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.errand_id}>
                  <td>
                    <Link to={`/errands/${encodeURIComponent(e.errand_id)}`} title={e.errand_id}>
                      {e.errand_id.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="mono">{e.sid}</td>
                  <td className="mono">{e.module}</td>
                  <td>
                    <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                  </td>
                  <td className="mono">{e.exit_code ?? '—'}</td>
                  <td className="mono">{e.duration_ms ?? '—'}</td>
                  <td className="mono">{e.started_at}</td>
                  <td className="mono">{e.finished_at ?? '—'}</td>
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

function pagerStyle(disabled: boolean) {
  return {
    padding: '4px 10px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
  } as const;
}
