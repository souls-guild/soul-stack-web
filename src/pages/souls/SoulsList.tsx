import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { keeperApi, type SoulStatus, type SoulTransport } from '../../api/keeper';
import { Badge, Dot } from '../../components/primitives';
import { soulDot, soulTone } from '../../components/status';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

const SOUL_STATUSES: SoulStatus[] = ['pending', 'connected', 'disconnected', 'expired'];
const SOUL_TRANSPORTS: SoulTransport[] = ['agent', 'ssh'];

function formatTimeAgo(iso: string | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s назад`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m назад`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h назад`;
  return `${Math.floor(deltaSec / 86_400)}d назад`;
}

export function SoulsList() {
  const [status, setStatus] = useState<SoulStatus | ''>('');
  const [transport, setTransport] = useState<SoulTransport | ''>('');
  const [coven, setCoven] = useState<string>('');

  const q = useQuery({
    queryKey: ['souls', { status, transport, coven }],
    queryFn: () =>
      keeperApi.souls.list({
        status: status || undefined,
        transport: transport || undefined,
        coven: coven.trim() ? [coven.trim()] : undefined,
        limit: 200,
      }),
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Souls</h1>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SoulStatus | '')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">— все —</option>
            {SOUL_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>Transport</div>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as SoulTransport | '')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">— все —</option>
            {SOUL_TRANSPORTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>Coven (exact)</div>
          <input
            type="text"
            value={coven}
            onChange={(e) => setCoven(e.target.value)}
            placeholder="prod / coven-tag"
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

      {q.data && q.data.items.length === 0 ? (
        <div className={styles.empty}>
          Souls под фильтр не найдено. Регистрируются через <code className="mono">keeper.soul.create</code>.
        </div>
      ) : null}

      {q.data && q.data.items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SID</th>
              <th>Status</th>
              <th>Transport</th>
              <th>Covens</th>
              <th>Last seen</th>
              <th>Registered</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((row) => (
              <tr key={row.sid}>
                <td>
                  <Link to={`/souls/${encodeURIComponent(row.sid)}`}>{row.sid}</Link>
                </td>
                <td>
                  <span className={styles.statusCell}>
                    <Dot kind={soulDot(row.status)} title={row.status} />
                    <Badge tone={soulTone(row.status)}>{row.status}</Badge>
                  </span>
                </td>
                <td className="mono">{row.transport}</td>
                <td className="mono">{row.covens?.join(', ') || '—'}</td>
                <td className="mono">{formatTimeAgo(row.last_seen_at)}</td>
                <td className="mono">{formatTimeAgo(row.registered_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
