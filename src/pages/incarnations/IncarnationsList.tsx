import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { keeperApi, type IncarnationStatus } from '../../api/keeper';
import { Badge, Dot } from '../../components/primitives';
import { incarnationDot, incarnationTone } from '../../components/status';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

const INCARNATION_STATUSES: IncarnationStatus[] = [
  'provisioning',
  'ready',
  'applying',
  'error_locked',
  'migration_failed',
  'drift',
  'destroying',
  'destroy_failed',
];

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s назад`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m назад`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h назад`;
  return `${Math.floor(deltaSec / 86_400)}d назад`;
}

export function IncarnationsList() {
  const [status, setStatus] = useState<IncarnationStatus | ''>('');
  const [coven, setCoven] = useState<string>('');

  const q = useQuery({
    queryKey: ['incarnations', { status, coven }],
    queryFn: () =>
      keeperApi.incarnations.list({
        status: status || undefined,
        // openapi.yaml не предоставляет coven-filter для incarnation-list (только для souls);
        // оставлено как text-filter, применяемое клиентом ниже.
        limit: 100,
      }),
  });

  const items = (q.data?.items ?? []).filter((row) => {
    if (!coven.trim()) return true;
    return row.covens.some((c) => c.includes(coven.trim()));
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Incarnations</h1>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IncarnationStatus | '')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">— все —</option>
            {INCARNATION_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>Coven contains</div>
          <input
            type="text"
            value={coven}
            onChange={(e) => setCoven(e.target.value)}
            placeholder="prod / staging / ..."
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)' }}
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
        <div className={styles.empty}>
          Incarnation-ов под фильтр не найдено. Создаются через scenario `create` сервиса (см. <code className="mono">keeper.incarnation.create</code>).
        </div>
      ) : null}

      {items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Service</th>
              <th>Status</th>
              <th>Last drift check</th>
              <th>Updated</th>
              <th>Covens</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.name}>
                <td>
                  <Link to={`/incarnations/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                </td>
                <td className="mono">
                  {row.service}
                  <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>@{row.service_version}</span>
                </td>
                <td>
                  <span className={styles.statusCell}>
                    <Dot kind={incarnationDot(row.status)} title={row.status} />
                    <Badge tone={incarnationTone(row.status)}>{row.status}</Badge>
                  </span>
                </td>
                <td className="mono">{formatTimeAgo(row.last_drift_check_at)}</td>
                <td className="mono">{formatTimeAgo(row.updated_at)}</td>
                <td className="mono">{row.covens.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
