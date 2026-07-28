import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Play } from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { UtilTrend } from '../../components/UtilTrend';
import { soulDot, soulTone } from '../../components/status';
import { keeperApi, type HostTelemetry, type SoulListEntry } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useNow } from '../../hooks/useNow';
import common from '../common.module.css';
import styles from './HostUtilizationPanel.module.css';
import {
  ageSeconds,
  busiestDisk,
  busiestInode,
  formatBps,
  formatBpsShort,
  formatLoad,
  formatMb,
  formatPct,
  formatUptime,
  minMaxLast,
  ratioPct,
  skewMinutes,
  sortHostRows,
  spanSeconds,
  utilTone,
  type HostSortKey,
  type SortDir,
  type VitalsTone,
} from './hostVitals';

// Unified connected-hosts panel (NIM-127 rework). One table = the authoritative connected-souls
// list (who is attached to the incarnation's root Coven, ADR-008) LEFT-JOINed with host utilization
// from the incarnation telemetry aggregate. Base rows come from souls.list; a host with no telemetry
// yet degrades to "—". Sparklines+skew are a per-soul on-demand request (the window lives only on the
// soul endpoint), mounted only when a row is expanded → no N-polling. Freshness comes from the backend
// `stale` flag and counts up live via useNow between the 15s refetches.
const REFETCH_MS = 15000;

const meterTone: Record<VitalsTone, string> = {
  ok: styles.meter_ok,
  warn: styles.meter_warn,
  danger: styles.meter_danger,
};

const NATURAL_DIR: Record<HostSortKey, SortDir> = {
  host: 'asc',
  status: 'asc',
  cpu: 'desc',
  mem: 'desc',
  disk: 'desc',
  net: 'desc',
  load: 'desc',
  uptime: 'desc',
  fresh: 'asc',
};

interface HostRow {
  tele: HostTelemetry;
  soul: SoulListEntry | null;
  sid: string;
  status: string;
  cpu: number | null;
  memPct: number | null;
  diskPct: number | null;
  net: number | null;
  load1: number | null;
  uptime: number | null;
  ageSec: number | null;
}

export function HostUtilizationPanel({ incarnationName }: { incarnationName: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<HostSortKey>('host');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const now = useNow(1000);

  // AUTHORITATIVE row source: the telemetry aggregate resolves hosts via incarnation_membership
  // (NIM-124: membership ≠ coven==name), so it always returns the incarnation's real member hosts
  // with latest util + stale/collected_at. This is the set the merged table must show.
  const util = useQuery({
    queryKey: ['incarnation-telemetry', incarnationName],
    queryFn: () => keeperApi.incarnations.telemetry(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  // Enrichment ONLY: the souls registry with NO coven filter (coven ≠ membership). Best-effort
  // SID→{status,transport} join; a missing registry match → status "—". Never filters rows out.
  const souls = useQuery({
    queryKey: ['souls-registry', 500],
    queryFn: () => keeperApi.souls.list({ limit: 500 }),
  });

  const utilStatus = util.error instanceof ApiError ? util.error.status : null;
  // 403 → no permission for host telemetry; 404/501 → old Keeper / subsystem off. Soft degrade
  // (no red error-box), symmetric to the soul side; no rows to show in either case.
  const forbidden = utilStatus === 403;
  const unavailable = utilStatus === 404 || utilStatus === 501;

  const soulBySid = new Map<string, SoulListEntry>();
  for (const s of souls.data?.items ?? []) soulBySid.set(s.sid, s);

  const hosts = util.data?.hosts ?? [];
  const rows: HostRow[] = hosts.map((h) => {
    const l = h.latest ?? null;
    const disk = l ? busiestDisk(l.disks) : null;
    const soul = soulBySid.get(h.sid) ?? null;
    return {
      tele: h,
      soul,
      sid: h.sid,
      status: soul?.status ?? '',
      cpu: l ? l.cpu_pct : null,
      memPct: l ? ratioPct(l.mem_used_mb, l.mem_total_mb) : null,
      diskPct: disk ? disk.pct : null,
      net: l ? l.net_rx_bps + l.net_tx_bps : null,
      load1: l ? l.load1 : null,
      uptime: l ? l.uptime_sec : null,
      ageSec: ageSeconds(h.collected_at, now),
    };
  });
  const sorted = sortHostRows(rows, sortKey, sortDir);

  function onSort(key: HostSortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(NATURAL_DIR[key]);
    }
  }
  const ariaSort = (key: HostSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 16,
          gap: 12,
        }}
      >
        <h2 className={common.sectionTitle} style={{ margin: 0 }}>
          Connected souls
        </h2>
        <Link
          to={`/run?workload=command&target_coven=${encodeURIComponent(incarnationName)}`}
          aria-label={t('incarnations:runCommandOnHosts')}
        >
          <Button type="button" variant="primary">
            <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('incarnations:runCommandOnHosts')}
          </Button>
        </Link>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Member hosts of this incarnation. {t('incarnations:connectedSoulsDesc')}
      </p>

      {util.isLoading ? <div className={common.loading}>{t('loading')}</div> : null}
      {forbidden ? (
        <div className={common.empty} data-testid="util-forbidden">
          {t('incarnations:utilForbidden')}
        </div>
      ) : null}
      {unavailable ? (
        <div className={common.empty} data-testid="util-unavailable">
          {t('incarnations:utilUnavailable')}
        </div>
      ) : null}
      {util.error && !forbidden && !unavailable ? (
        <div className={common.errorBox}>{t('incarnations:utilLoadFailed', { detail: String(util.error) })}</div>
      ) : null}

      {util.data && hosts.length === 0 ? (
        <div className={common.empty} data-testid="util-empty">
          {t('incarnations:utilEmpty')}
        </div>
      ) : null}

      {hosts.length > 0 ? (
        <table className={common.table}>
          <thead>
            <tr>
              <SortHeader label={t('incarnations:utilHost')} col="host" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('host')} />
              <SortHeader label={t('incarnations:utilStatus')} col="status" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('status')} />
              <SortHeader label={t('incarnations:utilCpu')} col="cpu" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('cpu')} />
              <SortHeader label={t('incarnations:utilMem')} col="mem" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('mem')} />
              <SortHeader label={t('incarnations:utilDisk')} col="disk" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('disk')} />
              <SortHeader label={t('incarnations:utilNet')} col="net" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('net')} />
              <SortHeader label={t('incarnations:utilLoad')} col="load" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('load')} />
              <SortHeader label={t('incarnations:utilUptime')} col="uptime" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('uptime')} />
              <SortHeader label={t('incarnations:utilFresh')} col="fresh" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('fresh')} />
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const s = r.soul;
              const l = r.tele.latest ?? null;
              const open = expanded === r.sid;
              const disk = l ? busiestDisk(l.disks) : null;
              return (
                <Fragment key={r.sid}>
                  <tr>
                    <td className="mono">
                      <KeeperSidCell sid={r.sid} />
                    </td>
                    <td>
                      {s ? (
                        <span className={common.statusCell}>
                          <Dot kind={soulDot(s.status)} />
                          <Badge tone={soulTone(s.status)}>{s.status}</Badge>
                        </span>
                      ) : (
                        <span className="mono">—</span>
                      )}
                    </td>
                    {l ? (
                      <>
                        <td>
                          <MetricCell value={formatPct(l.cpu_pct)} pct={l.cpu_pct} tone={utilTone(l.cpu_pct)} />
                        </td>
                        <td>
                          <MetricCell
                            value={`${formatMb(l.mem_used_mb)} / ${formatMb(l.mem_total_mb)}`}
                            pct={r.memPct}
                            tone={utilTone(r.memPct)}
                          />
                        </td>
                        <td title={disk?.mount}>
                          {disk ? (
                            <MetricCell value={formatPct(disk.pct)} pct={disk.pct} tone={utilTone(disk.pct)} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono" title={`↓ ${formatBps(l.net_rx_bps)}  ↑ ${formatBps(l.net_tx_bps)}`}>
                          <NetPair rx={l.net_rx_bps} tx={l.net_tx_bps} />
                        </td>
                        <td
                          className="mono"
                          title={`1m ${formatLoad(l.load1)} · 5m ${formatLoad(l.load5)} · 15m ${formatLoad(l.load15)}`}
                        >
                          {formatLoad(l.load1)}
                        </td>
                        <td className="mono">{formatUptime(l.uptime_sec)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className={styles.mutedCell} data-testid="util-nojoin">
                        {t('incarnations:utilNoData')}
                      </td>
                    )}
                    <td>
                      <Freshness
                        stale={r.tele.stale}
                        collectedAt={r.tele.collected_at}
                        hasData={Boolean(l)}
                        now={now}
                      />
                    </td>
                    <td>
                      {l ? (
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={t(open ? 'incarnations:utilCollapseAria' : 'incarnations:utilExpandAria', {
                            sid: r.sid,
                          })}
                          onClick={() => setExpanded(open ? null : r.sid)}
                        >
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  {open && l ? (
                    <tr className={styles.sparkRow}>
                      <td colSpan={10}>
                        <HostTrends sid={r.sid} now={now} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {util.data?.truncated ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{t('incarnations:utilTruncated')}</p>
      ) : null}
    </>
  );
}

function SortHeader({
  label,
  col,
  active,
  dir,
  onSort,
  ariaSort,
}: {
  label: string;
  col: HostSortKey;
  active: HostSortKey;
  dir: SortDir;
  onSort: (k: HostSortKey) => void;
  ariaSort: 'ascending' | 'descending' | 'none';
}) {
  const isActive = active === col;
  return (
    <th
      scope="col"
      className={styles.sortTh}
      aria-sort={ariaSort}
      onClick={() => onSort(col)}
      data-testid={`host-th-${col}`}
    >
      {label}
      {isActive ? <span className={styles.caret}>{dir === 'asc' ? '▲' : '▼'}</span> : null}
    </th>
  );
}

function Freshness({
  stale,
  collectedAt,
  hasData,
  now,
}: {
  stale: boolean;
  collectedAt?: string;
  hasData: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  if (!hasData) {
    return (
      <span className={styles.freshness} data-testid="freshness-nodata">
        <Dot kind="off" /> {t('incarnations:utilNoData')}
      </span>
    );
  }
  if (stale) {
    return (
      <span className={styles.freshness} data-testid="freshness-stale">
        <Dot kind="warn" /> {t('incarnations:utilStale')}
      </span>
    );
  }
  const age = ageSeconds(collectedAt, now);
  let ageText = '—';
  if (age != null) {
    const [key, n] = ageBucket(age);
    ageText = t(key, { n });
  }
  return (
    <span className={styles.freshness} data-testid="freshness-fresh">
      <Dot kind="ok" title={collectedAt} /> {ageText}
    </span>
  );
}

function ageBucket(sec: number): [key: string, n: number] {
  if (sec < 60) return ['souls:timeAgoSeconds', sec];
  const m = Math.floor(sec / 60);
  if (m < 60) return ['souls:timeAgoMinutes', m];
  const h = Math.floor(m / 60);
  if (h < 24) return ['souls:timeAgoHours', h];
  return ['souls:timeAgoDays', Math.floor(h / 24)];
}

function MetricCell({ value, pct, tone }: { value: string; pct?: number | null; tone?: VitalsTone }) {
  return (
    <div className={styles.metricCell}>
      <span className={styles.metricValue}>{value}</span>
      {pct != null ? (
        <div className={styles.meterOuter}>
          <div
            className={`${styles.meterInner} ${meterTone[tone ?? 'ok']}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// Rx/Tx throughput pair (NIM-127): ↓ receive, ↑ transmit. Reused by the curated Net column.
function NetPair({ rx, tx }: { rx: number; tx: number }) {
  return (
    <span className={styles.netPair}>
      <ArrowDown size={11} aria-hidden />
      <span>{formatBps(rx)}</span>
      <ArrowUp size={11} aria-hidden />
      <span>{formatBps(tx)}</span>
    </span>
  );
}

// A specific host's trend charts + inode + skew — a separate per-soul request (a window exists
// only in the soul endpoint). Mounted only when the row is expanded → no N-polling. Uses the same
// shared UtilTrend charts as the soul page (CPU/Mem/Load1/Net↓/Net↑), one row across full width.
function HostTrends({ sid, now }: { sid: string; now: number }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['soul-telemetry', sid],
    queryFn: () => keeperApi.souls.telemetry(sid),
    enabled: Boolean(sid),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  if (q.isLoading) return <div className={styles.sparkLoading}>{t('loading')}</div>;
  if (q.error) {
    const soft = q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404);
    return (
      <div className={soft ? styles.sparkMuted : styles.sparkError}>
        {t('incarnations:utilWindowFailed', { detail: String(q.error) })}
      </div>
    );
  }

  const data = q.data;
  const win = [...(data?.window ?? [])].reverse(); // API newest-first → chronological
  const skew = skewMinutes(data?.collected_at, data?.received_at);
  if (win.length === 0) {
    return (
      <div className={styles.sparkMuted} data-testid="spark-empty">
        {t('incarnations:utilWindowEmpty')}
      </div>
    );
  }

  const cpu = win.map((p) => p.cpu_pct);
  const mem = win.map((p) => ratioPct(p.mem_used_mb, p.mem_total_mb) ?? 0);
  const load1 = win.map((p) => p.load1);
  const rx = win.map((p) => p.net_rx_bps);
  const tx = win.map((p) => p.net_tx_bps);
  const times = win.map((p) => p.collected_at);

  const spanSec = spanSeconds(win[0].collected_at, win[win.length - 1].collected_at);
  const spanText = spanSec != null && spanSec > 0 ? `~${formatUptime(spanSec)}` : null;

  const disks = data?.latest?.disks ?? [];
  const inode = busiestInode(disks);

  return (
    <div className={styles.trends} data-testid="host-trends">
      <div className={styles.trendsHead}>
        <span className={styles.trendsTitle}>Trends</span>
        <span className={styles.trendsSpan}>
          {win.length} samples{spanText ? ` · ${spanText}` : ''}
        </span>
      </div>
      <div className={styles.trendGrid}>
        <UtilTrend label={t('incarnations:utilCpu')} values={cpu} format={formatPct} times={times} now={now} min={0} max={100} tone={utilTone(minMaxLast(cpu)?.last)} testId="host-trend-cpu" />
        <UtilTrend label={t('incarnations:utilMem')} values={mem} format={formatPct} times={times} now={now} min={0} max={100} tone={utilTone(minMaxLast(mem)?.last)} testId="host-trend-mem" />
        <UtilTrend label={t('incarnations:utilLoadShort')} values={load1} format={formatLoad} times={times} now={now} tone="accent" testId="host-trend-load" />
        <UtilTrend label={t('incarnations:utilNetRx')} values={rx} format={formatBps} axisFormat={formatBpsShort} times={times} now={now} min={0} tone="accent" testId="host-trend-rx" />
        <UtilTrend label={t('incarnations:utilNetTx')} values={tx} format={formatBps} axisFormat={formatBpsShort} times={times} now={now} min={0} tone="accent" testId="host-trend-tx" />
      </div>
      {disks.length > 0 ? (
        <div className={styles.inodeBlock} data-testid="spark-inodes">
          <span className={styles.sparkLabel}>Inodes</span>
          <span className={styles.inodeValue}>{inode ? `${formatPct(inode.pct)} (${inode.mount})` : 'n/a'}</span>
        </div>
      ) : null}
      {skew != null ? <div className={styles.skew}>{t('souls:skewWarning', { minutes: skew })}</div> : null}
    </div>
  );
}
