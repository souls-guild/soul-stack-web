import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { keeperApi, type SoulListEntry, type SoulStatus, type SoulTransport } from '../../api/keeper';
import { Badge, Button, Dot } from '../../components/primitives';
import { soulDot, soulTone } from '../../components/status';
import { ApiError } from '../../api/client';
import { CovenAssignModal } from './CovenAssignModal';
import styles from '../common.module.css';

const SOUL_STATUSES: SoulStatus[] = ['pending', 'connected', 'disconnected', 'expired'];
const SOUL_TRANSPORTS: SoulTransport[] = ['agent', 'ssh'];

// Конвенция coven-метки (openapi.yaml): lowercase, цифры, дефис-разделитель.
const COVEN_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

type SortKey = 'last_seen_at' | 'sid' | 'status';
type SortDir = 'asc' | 'desc';

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

// Парсит CSV-строку coven-меток ("prod, redis-prod, stage") в массив
// валидных меток + список невалидных (для inline-warning). openapi.yaml
// поддерживает `?coven=X&coven=Y` (style: form, explode: true) — multi-OR.
function parseCovens(input: string): { valid: string[]; invalid: string[] } {
  const tokens = input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (COVEN_PATTERN.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

// Сортировка по двум ключам с явной обработкой undefined у last_seen_at.
function sortItems(items: SoulListEntry[], key: SortKey, dir: SortDir): SoulListEntry[] {
  const arr = [...items];
  arr.sort((a, b) => {
    let cmp = 0;
    if (key === 'sid') {
      cmp = a.sid.localeCompare(b.sid);
    } else if (key === 'status') {
      cmp = a.status.localeCompare(b.status);
    } else {
      // last_seen_at: undefined → бесконечность давно (sort to bottom для desc).
      const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      cmp = ta - tb;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return arr;
}

export function SoulsList() {
  const [status, setStatus] = useState<SoulStatus | ''>('');
  const [transport, setTransport] = useState<SoulTransport | ''>('');
  const [coven, setCoven] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('last_seen_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [bulkOpen, setBulkOpen] = useState(false);

  const parsed = useMemo(() => parseCovens(coven), [coven]);
  const covenFilter = parsed.valid.length > 0 ? parsed.valid : undefined;

  const q = useQuery({
    queryKey: ['souls', { status, transport, coven: covenFilter }],
    queryFn: () =>
      keeperApi.souls.list({
        status: status || undefined,
        transport: transport || undefined,
        coven: covenFilter,
        limit: 200,
      }),
  });

  // Server-side: status/transport/coven. Client-side: search (contains) + sort.
  const visible = useMemo<SoulListEntry[]>(() => {
    if (!q.data) return [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? q.data.items.filter((it) => it.sid.toLowerCase().includes(needle))
      : q.data.items;
    return sortItems(filtered, sortKey, sortDir);
  }, [q.data, search, sortKey, sortDir]);

  // selected чистим от исчезнувших SID-ов после смены фильтра (UX-аккуратность).
  const visibleSidSet = useMemo(() => new Set(visible.map((it) => it.sid)), [visible]);
  const effectiveSelected = useMemo(() => {
    const out = new Set<string>();
    for (const sid of selected) if (visibleSidSet.has(sid)) out.add(sid);
    return out;
  }, [selected, visibleSidSet]);

  function toggle(sid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }
  function toggleAll() {
    if (effectiveSelected.size === visible.length && visible.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((it) => it.sid)));
    }
  }

  function clickSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'last_seen_at' ? 'desc' : 'asc');
    }
  }

  function sortGlyph(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  const allChecked = visible.length > 0 && effectiveSelected.size === visible.length;
  const someChecked = effectiveSelected.size > 0 && !allChecked;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Souls</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            type="button"
            variant="primary"
            disabled={effectiveSelected.size === 0}
            onClick={() => setBulkOpen(true)}
          >
            <Shield size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Bulk: Assign Coven{effectiveSelected.size > 0 ? ` (${effectiveSelected.size})` : ''}
          </Button>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Search SID (contains)</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="host01"
            aria-label="search SID"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
              minWidth: 200,
            }}
          />
        </label>
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
          <div className={styles.metaKey}>Covens (CSV, OR)</div>
          <input
            type="text"
            value={coven}
            onChange={(e) => setCoven(e.target.value)}
            placeholder="prod, redis-prod, ..."
            aria-invalid={parsed.invalid.length > 0 ? 'true' : undefined}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${parsed.invalid.length > 0 ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
              minWidth: 240,
            }}
          />
          {parsed.invalid.length > 0 ? (
            <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
              Не валидные метки: {parsed.invalid.join(', ')} (lowercase, цифры, дефис-разделитель).
            </span>
          ) : null}
        </label>
      </div>

      {q.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
        </div>
      ) : null}

      {q.data && visible.length === 0 ? (
        <div className={styles.empty}>
          {search ? 'Под search-фильтр ничего не нашлось.' : (
            <>Souls под фильтр не найдено. Регистрируются через <code className="mono">keeper.soul.create</code>.</>
          )}
        </div>
      ) : null}

      {q.data && visible.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label="выбрать все"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                />
              </th>
              <th>
                <button
                  type="button"
                  onClick={() => clickSort('sid')}
                  style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
                >
                  SID{sortGlyph('sid')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  onClick={() => clickSort('status')}
                  style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
                >
                  Status{sortGlyph('status')}
                </button>
              </th>
              <th>Transport</th>
              <th>Covens</th>
              <th>
                <button
                  type="button"
                  onClick={() => clickSort('last_seen_at')}
                  style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
                >
                  Last seen{sortGlyph('last_seen_at')}
                </button>
              </th>
              <th>Registered</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.sid}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`выбрать ${row.sid}`}
                    checked={effectiveSelected.has(row.sid)}
                    onChange={() => toggle(row.sid)}
                  />
                </td>
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

      <CovenAssignModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        variant={{ kind: 'bulk', sids: [...effectiveSelected] }}
      />
    </div>
  );
}
