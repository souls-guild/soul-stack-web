import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  keeperApi,
  type ErrandResult,
  type ErrandStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import styles from '../common.module.css';

const STATUSES: ErrandStatus[] = ['running', 'success', 'failed', 'timed_out', 'cancelled', 'module_not_allowed'];

function statusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success': return 'ok';
    case 'failed':
    case 'timed_out':
    case 'module_not_allowed': return 'danger';
    case 'cancelled': return 'muted';
    case 'running': return 'info';
    default: return 'muted';
  }
}

function preview(text?: string, max = 80): string {
  if (!text) return '—';
  const oneline = text.replace(/\s+/g, ' ').trim();
  if (oneline.length <= max) return oneline;
  return oneline.slice(0, max) + '…';
}

function FullView({ errand, onClose }: { errand: ErrandResult; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={`Errand ${errand.errand_id}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, #000 60%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          maxWidth: 920,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 'var(--s-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <strong className="mono">{errand.errand_id}</strong>
          <button onClick={onClose} aria-label="закрыть" style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className={styles.meta}>
          <span className={styles.metaKey}>status</span>
          <span><Badge tone={statusTone(errand.status)}>{errand.status}</Badge></span>
          <span className={styles.metaKey}>module</span>
          <span className={styles.metaVal}>{errand.module}</span>
          <span className={styles.metaKey}>sid</span>
          <span className={styles.metaVal}>{errand.sid}</span>
          {errand.exit_code !== undefined && errand.exit_code !== null ? (
            <>
              <span className={styles.metaKey}>exit_code</span>
              <span className={styles.metaVal}>{errand.exit_code}</span>
            </>
          ) : null}
          {errand.duration_ms !== undefined ? (
            <>
              <span className={styles.metaKey}>duration_ms</span>
              <span className={styles.metaVal}>{errand.duration_ms}</span>
            </>
          ) : null}
          <span className={styles.metaKey}>started_at</span>
          <span className={styles.metaVal}>{errand.started_at}</span>
          {errand.finished_at ? (
            <>
              <span className={styles.metaKey}>finished_at</span>
              <span className={styles.metaVal}>{errand.finished_at}</span>
            </>
          ) : null}
        </div>
        {errand.stdout ? (
          <details open>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              stdout{errand.stdout_truncated ? ' · truncated' : ''}
            </summary>
            <pre style={{ margin: 0, padding: 12, background: 'var(--surface-2)', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {errand.stdout}
              {errand.stdout_truncated ? '\n[truncated]' : ''}
            </pre>
          </details>
        ) : null}
        {errand.stderr ? (
          <details>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              stderr{errand.stderr_truncated ? ' · truncated' : ''}
            </summary>
            <pre style={{ margin: 0, padding: 12, background: 'var(--surface-2)', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {errand.stderr}
              {errand.stderr_truncated ? '\n[truncated]' : ''}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function ErrandHistory() {
  const [sid, setSid] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [status, setStatus] = useState<ErrandStatus | ''>('');
  const [startedAfter, setStartedAfter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ErrandResult | null>(null);

  const limit = 50;
  const q = useQuery({
    queryKey: ['errands.list', { sid, status, startedAfter, offset }],
    queryFn: () =>
      keeperApi.errands.list({
        sid: sid || undefined,
        status: status || undefined,
        started_after: startedAfter || undefined,
        offset,
        limit,
      }),
  });

  // module-фильтр клиентский: openapi не поддерживает ?module=.
  const items = (q.data?.items ?? []).filter((e) =>
    moduleFilter ? (e.module ?? '').includes(moduleFilter) : true,
  );
  const total = q.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Errand history</h1>
          <div className={styles.crumbs}>журнал ad-hoc прогонов (ADR-033)</div>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>SID</div>
          <input
            type="text"
            value={sid}
            onChange={(e) => { setSid(e.target.value); setOffset(0); }}
            placeholder="host01.example.com"
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', minWidth: 220 }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Module (substring)</div>
          <input
            type="text"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            placeholder="core.cmd"
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)' }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Status</div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as ErrandStatus | ''); setOffset(0); }}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">— все —</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>Started after (RFC3339)</div>
          <input
            type="text"
            value={startedAfter}
            onChange={(e) => { setStartedAfter(e.target.value); setOffset(0); }}
            placeholder="2026-05-25T00:00:00Z"
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', minWidth: 220 }}
          />
        </label>
      </div>

      {q.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>Errand-ов под фильтр не найдено.</div>
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
                <th>Stdout preview</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.errand_id}>
                  <td className="mono" title={e.errand_id}>{e.errand_id.slice(0, 10)}…</td>
                  <td className="mono">{e.sid}</td>
                  <td className="mono">{e.module}</td>
                  <td><Badge tone={statusTone(e.status)}>{e.status}</Badge></td>
                  <td className="mono">{e.exit_code ?? '—'}</td>
                  <td className="mono">{e.duration_ms ?? '—'}</td>
                  <td className="mono" style={{ maxWidth: 280 }}>{preview(e.stdout)}</td>
                  <td>
                    <button
                      onClick={() => setSelected(e)}
                      style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
                    >
                      View full
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: offset === 0 ? 'not-allowed' : 'pointer' }}
            >
              ← Prev
            </button>
            <span>{offset + 1}–{offset + items.length} of {total}</span>
            <button
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: offset + limit >= total ? 'not-allowed' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        </>
      ) : null}

      {selected ? <FullView errand={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
