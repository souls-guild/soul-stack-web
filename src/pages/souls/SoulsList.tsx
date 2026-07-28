import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Play, Plus, Search, Shield, Tag } from 'lucide-react';
import i18n from '../../i18n';
import { keeperApi, SoulprintNotReceivedError, type SoulListEntry, type SoulStatus, type SoulTransport, type SoulprintReadReply } from '../../api/keeper';
import { Badge, Button, Dot } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { soulDot, soulTone } from '../../components/status';
import { ApiError } from '../../api/client';
import { CovenAssignModal } from './CovenAssignModal';
import { TraitsAssignModal } from './TraitsAssignModal';
import { CreateSoulModal } from './CreateSoulModal';
import { applyFilter, parseSoulprintFilter } from './soulprintFilter';
import { filtersToCEL } from '../run/targetTranslator';
import styles from '../common.module.css';

// satisfies ensures the lists are a subset of SoulStatus/SoulTransport; tsc will fail if the backend enum is extended
const SOUL_STATUSES = ['pending', 'connected', 'disconnected', 'expired'] as const satisfies readonly SoulStatus[];
const SOUL_TRANSPORTS = ['agent', 'ssh'] as const satisfies readonly SoulTransport[];

// Coven-label convention (openapi.yaml): lowercase, digits, hyphen-separated.
const COVEN_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const PAGE_LIMIT = 100;

type SortKey = 'last_seen_at' | 'sid' | 'status';
type SortDir = 'asc' | 'desc';

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const t = i18n.t.bind(i18n);
  if (deltaSec < 60) return t('souls:timeAgoSeconds', { n: deltaSec });
  if (deltaSec < 3600) return t('souls:timeAgoMinutes', { n: Math.floor(deltaSec / 60) });
  if (deltaSec < 86_400) return t('souls:timeAgoHours', { n: Math.floor(deltaSec / 3600) });
  return t('souls:timeAgoDays', { n: Math.floor(deltaSec / 86_400) });
}

// Parses a CSV string of coven labels ("prod, redis-prod, stage") into an
// array of valid labels + a list of invalid ones (for inline-warning). openapi.yaml
// supports `?coven=X&coven=Y` (style: form, explode: true) -- multi-OR.
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

// Sorting by two keys with explicit handling of undefined for last_seen_at.
function sortItems(items: SoulListEntry[], key: SortKey, dir: SortDir): SoulListEntry[] {
  const arr = [...items];
  arr.sort((a, b) => {
    let cmp = 0;
    if (key === 'sid') {
      cmp = a.sid.localeCompare(b.sid);
    } else if (key === 'status') {
      cmp = a.status.localeCompare(b.status);
    } else {
      // last_seen_at: undefined -> infinitely long ago (sort to bottom for desc).
      const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      cmp = ta - tb;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return arr;
}

export function SoulsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SoulStatus | ''>('');
  const [transport, setTransport] = useState<SoulTransport | ''>('');
  const [coven, setCoven] = useState<string>('');
  const [search, setSearch] = useState('');
  const [soulprintQuery, setSoulprintQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('last_seen_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTraitOpen, setBulkTraitOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // accumulated -- accumulator of all loaded items.
  const [accumulated, setAccumulated] = useState<SoulListEntry[]>([]);
  // Flags from the last response: whether there are more pages and whether total is approximate.
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [totalApproximate, setTotalApproximate] = useState<boolean>(false);
  const [serverTotal, setServerTotal] = useState<number>(0);
  // loadMorePending: true while an additional page is loading (not the first request).
  const [loadMorePending, setLoadMorePending] = useState(false);
  // loadMoreError: error while loading an additional page (not the first).
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const parsed = useMemo(() => parseCovens(coven), [coven]);
  const covenFilter = parsed.valid.length > 0 ? parsed.valid : undefined;

  // Reset the accumulator and cursor when server filters change.
  const serverFilterKey = JSON.stringify({ status, transport, coven: covenFilter });

  // First page -- via useQuery without a cursor.
  // queryKey contains serverFilterKey so the cache resets when filters change.
  // queryFn -- a pure function (only returns data, no setState).
  const q = useQuery({
    queryKey: ['souls-page0', serverFilterKey],
    queryFn: async () => {
      return keeperApi.souls.list({
        status: status || undefined,
        transport: transport || undefined,
        coven: covenFilter,
        limit: PAGE_LIMIT,
      });
    },
  });

  // filterKeyRef -- a synchronous reference to the current serverFilterKey.
  // Updated before setState in useEffect, so after any await in loadMore
  // ref.current is guaranteed to contain the current key (no stale closure).
  const filterKeyRef = useRef<string>('');

  // Sync the accumulator with the first page via useEffect.
  // Resets the accumulator only when serverFilterKey changes (new set),
  // not on refetch of the same key (reconnect does not clear accumulated data).
  useEffect(() => {
    if (!q.data) return;
    if (filterKeyRef.current !== serverFilterKey) {
      // Update the ref first -- before setState, so loadMore sees the new key
      // immediately, even if the render has not happened yet.
      filterKeyRef.current = serverFilterKey;
      setAccumulated(q.data.items ?? []);
      setNextCursor(q.data.next_cursor ?? undefined);
      setTotalApproximate(q.data.total_approximate ?? false);
      setServerTotal(q.data.total);
      setLoadMoreError(null);
    }
  }, [q.data, serverFilterKey]);

  // "Load more" -- an explicit callback, not useQuery, since this is an imperative fetch.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadMorePending) return;
    // Capture the current filter key BEFORE the await.
    // After the await, compare against filterKeyRef.current -- if the filter changed,
    // discard the result (do not mix stale souls into the new set).
    const requestedKey = filterKeyRef.current;
    setLoadMorePending(true);
    setLoadMoreError(null);
    try {
      const result = await keeperApi.souls.list({
        status: status || undefined,
        transport: transport || undefined,
        coven: covenFilter,
        limit: PAGE_LIMIT,
        cursor: nextCursor,
      });
      // Check after the await: the filter may have changed while the request was in flight.
      if (filterKeyRef.current !== requestedKey) {
        // Filter is stale -- discard the whole result.
        return;
      }
      setAccumulated((prev) => {
        // Dedup by sid in case of a double click.
        const existingSids = new Set(prev.map((it) => it.sid));
        const fresh = (result.items ?? []).filter((it) => !existingSids.has(it.sid));
        return [...prev, ...fresh];
      });
      setNextCursor(result.next_cursor ?? undefined);
      setTotalApproximate(result.total_approximate ?? false);
      setServerTotal(result.total);
    } catch (err) {
      // Show the error only if the filter has not changed -- otherwise it
      // refers to the old set and misleads the operator.
      if (filterKeyRef.current === requestedKey) {
        setLoadMoreError(
          err instanceof ApiError
            ? t('errors:generic', { status: err.status, detail: err.message })
            : String(err),
        );
      }
    } finally {
      setLoadMorePending(false);
    }
  }, [nextCursor, loadMorePending, status, transport, covenFilter, t]);

  // Parsing the soulprint DSL filter. Invalid tokens are shown inline-warn,
  // only valid rules go into filtering.
  const parsedSoulprint = useMemo(() => parseSoulprintFilter(soulprintQuery), [soulprintQuery]);
  const soulprintRules = parsedSoulprint.rules;
  const soulprintFilterActive = soulprintRules.length > 0;

  // Stage 1: server-side filters are already applied in accumulated. Client-side SID-search + sort.
  const prefiltered = useMemo<SoulListEntry[]>(() => {
    if (q.isLoading && accumulated.length === 0) return [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? accumulated.filter((it) => it.sid.toLowerCase().includes(needle))
      : accumulated;
    return sortItems(filtered, sortKey, sortDir);
  }, [accumulated, q.isLoading, search, sortKey, sortDir]);

  // Stage 2: lazy fetch soulprint for each SID, only if the soulprint filter is active.
  // 410 (soulprint not received) -> null, error -> null, so the host is excluded
  // instead of failing the whole state. Cache 60s -- matches spec.
  const soulprintQueries = useQueries({
    queries: prefiltered.map((row) => ({
      queryKey: ['soulprint', row.sid] as const,
      queryFn: async (): Promise<SoulprintReadReply | null> => {
        try {
          return await keeperApi.souls.getSoulprint(row.sid);
        } catch (err) {
          if (err instanceof SoulprintNotReceivedError) return null;
          throw err;
        }
      },
      enabled: soulprintFilterActive,
      staleTime: 60_000,
      retry: false,
    })),
  });

  const soulprintLoading =
    soulprintFilterActive && soulprintQueries.some((res) => res.isLoading);

  // Stage 3: applying soulprint rules. If there are no rules -- return prefiltered as-is.
  const visible = useMemo<SoulListEntry[]>(() => {
    if (!soulprintFilterActive) return prefiltered;
    const out: SoulListEntry[] = [];
    for (let i = 0; i < prefiltered.length; i++) {
      const sp = soulprintQueries[i]?.data;
      if (!sp || !sp.typed_facts) continue;
      if (applyFilter(sp.typed_facts, soulprintRules)) {
        out.push(prefiltered[i]);
      }
    }
    return out;
  }, [prefiltered, soulprintFilterActive, soulprintQueries, soulprintRules]);

  // Clean up selected from vanished SIDs after a filter change (UX tidiness).
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

  // Building a CEL fragment from active filters for the "Run on filtered" action button.
  // If no filter is active -- the button is disabled (running "on the whole fleet"
  // is treated as an explicit risk-action, not offered with one click).
  const filteredWhereCEL = useMemo(() => {
    return filtersToCEL({
      status: status || undefined,
      transport: transport || undefined,
      covens: covenFilter,
      soulprintRules: soulprintRules.length > 0 ? soulprintRules : undefined,
      sidSearch: search.trim() || undefined,
    });
  }, [status, transport, covenFilter, soulprintRules, search]);

  function bulkRunOnSelected() {
    if (effectiveSelected.size === 0) return;
    const sids = Array.from(effectiveSelected).join(',');
    navigate(`/run?workload=command&target_sids=${encodeURIComponent(sids)}`);
  }
  function runOnFiltered() {
    if (!filteredWhereCEL) return;
    navigate(`/run?workload=command&target_where=${encodeURIComponent(filteredWhereCEL)}`);
  }

  // Counter of the loaded set accounting for total approximation.
  // Shown only when data exists and the filter is inactive (otherwise the matched-line overlaps).
  // Logic:
  //   - keyset mode (totalApproximate=true): "Shown N, total ~M" while nextCursor exists,
  //     or "~M soul(s)" when everything is loaded.
  //   - offset mode (totalApproximate=false): no separate counter shown (UI unchanged).
  function renderTotalBadge() {
    if (!q.data || soulprintFilterActive) return null;
    // When client-side search is active: show only visible rows, without server total.
    if (search.trim()) {
      return (
        <div className={styles.metaKey} aria-live="polite" data-testid="count-filtered">
          {t('souls:countFiltered', { count: visible.length })}
        </div>
      );
    }
    if (!totalApproximate) return null; // offset mode: no counter needed
    if (nextCursor) {
      return (
        <div className={styles.metaKey} aria-live="polite" data-testid="count-approximate">
          {t('souls:countShownOfApproximate', { shown: accumulated.length, total: serverTotal })}
        </div>
      );
    }
    // Everything loaded, show the total with a marker.
    return (
      <div className={styles.metaKey} aria-live="polite" data-testid="count-approximate">
        {t('souls:countApproximate', { count: accumulated.length })}
      </div>
    );
  }

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
            onClick={bulkRunOnSelected}
            aria-label={t('souls:bulkRunAriaLabel')}
          >
            <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('souls:bulkRunOnSelected', { count: effectiveSelected.size > 0 ? `${effectiveSelected.size} ` : '' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={effectiveSelected.size === 0}
            onClick={() => setBulkOpen(true)}
          >
            <Shield size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('souls:bulkAssignCoven', { suffix: effectiveSelected.size > 0 ? ` (${effectiveSelected.size})` : '' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={effectiveSelected.size === 0}
            onClick={() => setBulkTraitOpen(true)}
          >
            <Tag size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('souls:bulkAssignTrait', { suffix: effectiveSelected.size > 0 ? ` (${effectiveSelected.size})` : '' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => setCreateOpen(true)}
            aria-label={t('souls:registerSoulAria')}
            data-testid="register-soul-btn"
          >
            <Plus size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('souls:registerSoul')}
          </Button>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>{t('souls:searchSidLabel')}</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('souls:searchSidPlaceholder')}
            aria-label={t('souls:searchSidAria')}
            data-testid="souls-search-input"
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
        <label style={{ flex: '1 1 320px', minWidth: 280 }}>
          <div className={styles.metaKey}>{t('souls:soulprintSearchLabel')}</div>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={soulprintQuery}
              onChange={(e) => setSoulprintQuery(e.target.value)}
              placeholder={t('souls:soulprintSearchPlaceholder')}
              aria-label={t('souls:soulprintSearchAria')}
              data-testid="soulprint-search-input"
              aria-invalid={parsedSoulprint.invalid.length > 0 ? 'true' : undefined}
              style={{
                padding: '8px 10px 8px 30px',
                width: '100%',
                borderRadius: 'var(--radius)',
                border: `1px solid ${parsedSoulprint.invalid.length > 0 ? 'var(--danger)' : 'var(--border)'}`,
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4, display: 'block' }}>
            {t('souls:soulprintSearchHint')}
          </span>
          {parsedSoulprint.invalid.length > 0 ? (
            <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
              {t('souls:soulprintUnrecognized', { tokens: parsedSoulprint.invalid.join(', ') })}
            </span>
          ) : null}
        </label>
        <label>
          <div className={styles.metaKey}>{t('colStatus')}</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SoulStatus | '')}
            data-testid="souls-status-filter"
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">{t('souls:allOption')}</option>
            {SOUL_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>{t('colTransport')}</div>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as SoulTransport | '')}
            data-testid="souls-transport-filter"
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="">{t('souls:allOption')}</option>
            {SOUL_TRANSPORTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>{t('souls:covensLabel')}</div>
          <input
            type="text"
            value={coven}
            onChange={(e) => setCoven(e.target.value)}
            placeholder={t('souls:covensPlaceholder')}
            data-testid="souls-coven-filter"
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
              {t('souls:covensInvalidLabels', { tokens: parsed.invalid.join(', ') })}
            </span>
          ) : null}
        </label>
      </div>

      {renderTotalBadge()}

      {soulprintFilterActive ? (
        <div className={styles.metaKey} aria-live="polite">
          {soulprintLoading
            ? t('souls:loadingSoulprints', { count: prefiltered.length })
            : t('souls:matched', { shown: visible.length, total: prefiltered.length })}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <Button
          type="button"
          variant="ghost"
          disabled={!filteredWhereCEL}
          onClick={runOnFiltered}
          aria-label={t('souls:runOnFilteredAria')}
          title={filteredWhereCEL
            ? t('souls:runOnFilteredTitle', { cel: filteredWhereCEL })
            : t('souls:runOnFilteredNoFilter')}
        >
          <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {t('souls:runOnFiltered', { suffix: visible.length > 0 ? ` (${visible.length} souls)` : '' })}
        </Button>
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
        </div>
      ) : null}

      {q.data && visible.length === 0 && !soulprintLoading ? (
        <div className={styles.empty}>
          {soulprintFilterActive
            ? t('souls:emptySoulprintFilter')
            : search
              ? t('souls:emptySearch')
              : (
                <>
                  {t('souls:emptyNoSouls')}{' '}
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: 0,
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      font: 'inherit',
                      textDecoration: 'underline',
                    }}
                  >
                    {t('souls:registerSoul')}
                  </button>
                  .
                </>
              )}
        </div>
      ) : null}

      {q.data && visible.length > 0 ? (
        <table className={styles.table} data-testid="souls-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label={t('souls:selectAll')}
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
              <th>{t('colTransport')}</th>
              <th>{t('common:colCovens')}</th>
              <th>
                <button
                  type="button"
                  onClick={() => clickSort('last_seen_at')}
                  style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
                >
                  Last seen{sortGlyph('last_seen_at')}
                </button>
              </th>
              <th>{t('colRegistered')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.sid} data-testid={`souls-row-${row.sid}`}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t('souls:selectRow', { sid: row.sid })}
                    checked={effectiveSelected.has(row.sid)}
                    onChange={() => toggle(row.sid)}
                  />
                </td>
                <td>
                  <KeeperSidCell sid={row.sid} />
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

      {/* "Load more" -- shown only in keyset mode, while nextCursor exists */}
      {loadMoreError ? (
        <div className={styles.errorBox} data-testid="load-more-error">
          {loadMoreError}
        </div>
      ) : null}
      {nextCursor ? (
        <div className={styles.loadMoreCenter}>
          <Button
            type="button"
            variant="ghost"
            disabled={loadMorePending}
            onClick={loadMore}
            data-testid="load-more-btn"
          >
            {loadMorePending ? t('souls:loadingMore') : t('souls:loadMore')}
          </Button>
        </div>
      ) : null}

      <CovenAssignModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        variant={{ kind: 'bulk', sids: [...effectiveSelected] }}
      />
      <TraitsAssignModal
        open={bulkTraitOpen}
        onClose={() => setBulkTraitOpen(false)}
        variant={{ kind: 'bulk', sids: [...effectiveSelected] }}
      />

      <CreateSoulModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
