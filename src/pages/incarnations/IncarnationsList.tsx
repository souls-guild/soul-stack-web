import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Box, Plus } from 'lucide-react';
import { keeperApi, type IncarnationGetReply, type IncarnationStatus } from '../../api/keeper';
import { Badge, Button, Dot } from '../../components/primitives';
import { incarnationDot, incarnationTone } from '../../components/status';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';
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

const COVEN_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

type SortKey = 'created_at' | 'name' | 'status';
type SortDir = 'asc' | 'desc';

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const ago = i18n.t('incarnations:ago');
  if (deltaSec < 60) return `${deltaSec}s ${ago}`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ${ago}`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ${ago}`;
  return `${Math.floor(deltaSec / 86_400)}d ${ago}`;
}

function sortItems(items: IncarnationGetReply[], key: SortKey, dir: SortDir): IncarnationGetReply[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    let av: string;
    let bv: string;
    switch (key) {
      case 'name':
        av = a.name;
        bv = b.name;
        break;
      case 'status':
        av = a.status;
        bv = b.status;
        break;
      default:
        av = a.created_at;
        bv = b.created_at;
    }
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
}

export function IncarnationsList() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState<string>('');
  const [status, setStatus] = useState<IncarnationStatus | ''>('');
  const [coven, setCoven] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const trimmedCoven = coven.trim();
  const covenValid = trimmedCoven === '' || COVEN_PATTERN.test(trimmedCoven);
  const effectiveCoven = covenValid && trimmedCoven !== '' ? trimmedCoven : undefined;

  const services = useQuery({
    queryKey: ['services.list'],
    queryFn: () => keeperApi.services.list(),
  });

  const q = useQuery({
    queryKey: ['incarnations', { service: serviceFilter, status, coven: effectiveCoven }],
    queryFn: () =>
      keeperApi.incarnations.list({
        service: serviceFilter || undefined,
        status: status || undefined,
        coven: effectiveCoven,
        limit: 200,
      }),
    enabled: covenValid,
  });

  const filtered = useMemo(() => {
    const items = q.data?.items ?? [];
    const term = search.trim().toLowerCase();
    const base = term ? items.filter((it) => it.name.toLowerCase().includes(term)) : items;
    return sortItems(base, sortKey, sortDir);
  }, [q.data, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  const serviceItems = services.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Box size={22} /> Incarnations
          </h1>
        </div>
        <div>
          <Link to="/incarnations/new">
            <Button variant="primary">
              <Plus size={14} /> Create
            </Button>
          </Link>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Search by name</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="redis / postgres / …"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Service</div>
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <option value="">{t('incarnations:allCovens')}</option>
            {serviceItems.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IncarnationStatus | '')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">{t('incarnations:allCovens')}</option>
            {INCARNATION_STATUSES.map((s) => (
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
            placeholder="prod / staging / ..."
            aria-invalid={!covenValid ? 'true' : undefined}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${covenValid ? 'var(--border)' : 'var(--danger)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {!covenValid ? (
            <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
              {t('incarnations:covenInvalid')}
            </span>
          ) : null}
        </label>
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
        </div>
      ) : null}

      {q.data && filtered.length === 0 ? (
        <div className={styles.empty}>
          {t('incarnations:listEmptyLead')} <strong>Create</strong>{t('incarnations:listEmptyHint')}{' '}
          <code className="mono">create</code> {t('incarnations:listEmptyTail')}
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => toggleSort('name')} style={{ all: 'unset', cursor: 'pointer' }}>
                  Name{sortArrow('name')}
                </button>
              </th>
              <th>Service</th>
              <th>
                <button type="button" onClick={() => toggleSort('status')} style={{ all: 'unset', cursor: 'pointer' }}>
                  Status{sortArrow('status')}
                </button>
              </th>
              <th>Covens</th>
              <th>
                <button type="button" onClick={() => toggleSort('created_at')} style={{ all: 'unset', cursor: 'pointer' }}>
                  Created{sortArrow('created_at')}
                </button>
              </th>
              <th>Last drift check</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
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
                <td className="mono">
                  {row.covens.length > 0 ? (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      {row.covens.map((c) => (
                        <Badge key={c} tone="muted">{c}</Badge>
                      ))}
                    </span>
                  ) : '—'}
                </td>
                <td className="mono" title={row.created_at}>{formatTimeAgo(row.created_at)}</td>
                <td className="mono">{formatTimeAgo(row.last_drift_check_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
