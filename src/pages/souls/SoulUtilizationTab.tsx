import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { Dot } from '../../components/primitives';
import { type TelemetryDisk, type UtilizationWindowPoint } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useNow } from '../../hooks/useNow';
import common from '../common.module.css';
import styles from './SoulUtilizationTab.module.css';
import { useSoulTelemetry } from './useSoulTelemetry';
import { RadialGauge } from './RadialGauge';
import { UtilTrend } from '../../components/UtilTrend';
import {
  ageSeconds,
  busiestDisk,
  formatAgeShort,
  formatBps,
  formatBpsShort,
  formatLoad,
  formatMb,
  formatPct,
  formatUptime,
  inodePct,
  minMaxLast,
  ratioPct,
  skewMinutes,
  sortDisks,
  spanSeconds,
  utilTone,
  type DiskSortKey,
  type SortDir,
  type VitalsTone,
} from '../incarnations/hostVitals';

// Per-Soul host utilization (NIM-127, redesign). The soul telemetry endpoint carries the
// full spectrum: latest snapshot + a short window for trends + freshness. This page owns
// its own richer visuals (radial gauges + UtilTrend charts) — the shared Sparkline and the
// incarnation MembersPanel are deliberately left untouched. Two placements share one
// query (dedup via the queryKey, see useSoulTelemetry): the full tab and the Overview strip.
// Freshness comes from the backend `stale` flag; no latest → graceful "no data".

const tileTone: Record<VitalsTone, string> = {
  ok: styles.tileOk,
  warn: styles.tileWarn,
  danger: styles.tileDanger,
};

const meterTone: Record<VitalsTone, string> = {
  ok: styles.meter_ok,
  warn: styles.meter_warn,
  danger: styles.meter_danger,
};

// "14.6 / 56.9 GB" when used/total share a unit, else "512 MB / 16.0 GB".
function memCaption(usedMb: number, totalMb: number): string {
  const u = formatMb(usedMb);
  const total = formatMb(totalMb);
  const [uNum, uUnit] = u.split(' ');
  const tUnit = total.split(' ')[1];
  return uUnit && uUnit === tUnit ? `${uNum} / ${total}` : `${u} / ${total}`;
}

function ageBucket(sec: number): [key: string, n: number] {
  if (sec < 60) return ['souls:timeAgoSeconds', sec];
  const m = Math.floor(sec / 60);
  if (m < 60) return ['souls:timeAgoMinutes', m];
  const h = Math.floor(m / 60);
  if (h < 24) return ['souls:timeAgoHours', h];
  return ['souls:timeAgoDays', Math.floor(h / 24)];
}

export function SoulUtilizationTab({ sid, enabled }: { sid: string; enabled: boolean }) {
  const { t } = useTranslation();
  const q = useSoulTelemetry(sid, enabled);
  const now = Date.now();

  const status = q.error instanceof ApiError ? q.error.status : null;
  const forbidden = status === 403;
  const unavailable = status === 404 || status === 501;

  const data = q.data;
  const l = data?.latest;

  const memPct = l ? ratioPct(l.mem_used_mb, l.mem_total_mb) : null;
  const disk = l ? busiestDisk(l.disks) : null;

  return (
    <section className={common.section} data-testid="soul-util-tab">
      <h2 className={common.sectionTitle}>
        <Activity size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Utilization
      </h2>

      {q.isLoading ? <div className={common.loading}>{t('loading')}</div> : null}

      {forbidden ? (
        <div className={common.empty} data-testid="soul-util-forbidden">
          {t('incarnations:utilForbidden')}
        </div>
      ) : null}
      {unavailable ? (
        <div className={common.empty} data-testid="soul-util-unavailable">
          {t('incarnations:utilUnavailable')}
        </div>
      ) : null}
      {q.error && !forbidden && !unavailable ? (
        <div className={common.errorBox}>{t('incarnations:utilLoadFailed', { detail: String(q.error) })}</div>
      ) : null}

      {data && !l ? (
        <div className={common.empty} data-testid="soul-util-nodata">
          {t('incarnations:utilNoData')}
        </div>
      ) : null}

      {l ? (
        <>
          <Freshness stale={data?.stale ?? false} collectedAt={data?.collected_at} now={now} />
          <SkewNote collectedAt={data?.collected_at} receivedAt={data?.received_at} />

          <div className={styles.radials}>
            <RadialGauge label={t('incarnations:utilCpu')} pct={l.cpu_pct} testId="soul-radial-cpu" />
            <RadialGauge label={t('incarnations:utilMemory')} pct={memPct} sub={memCaption(l.mem_used_mb, l.mem_total_mb)} testId="soul-radial-mem" />
            <RadialGauge label={t('incarnations:utilDisk')} pct={disk?.pct ?? null} sub={disk?.mount} testId="soul-radial-disk" />
          </div>

          <div className={styles.detailGrid}>
            <Detail label={t('incarnations:utilLoad')} value={`${formatLoad(l.load1)} / ${formatLoad(l.load5)} / ${formatLoad(l.load15)}`} sub="1m / 5m / 15m" />
            <Detail label={t('incarnations:utilSwap')} value={formatMb(l.swap_used_mb)} />
            <Detail label={t('incarnations:utilUptime')} value={formatUptime(l.uptime_sec)} />
            <Detail label={t('incarnations:utilNetRx')} value={formatBps(l.net_rx_bps)} />
            <Detail label={t('incarnations:utilNetTx')} value={formatBps(l.net_tx_bps)} />
            <Detail label={t('incarnations:utilNetErr')} value={`${l.net_err_ps}/s`} />
            <Detail label={t('incarnations:utilInterval')} value={`${l.interval_sec}s`} />
          </div>

          <DiskTable disks={l.disks} />
          <WindowTrends window={data?.window} />
        </>
      ) : null}
    </section>
  );
}

function Freshness({ stale, collectedAt, now }: { stale: boolean; collectedAt?: string; now: number }) {
  const { t } = useTranslation();
  if (stale) {
    return (
      <span className={styles.freshness} data-testid="soul-util-fresh">
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
    <span className={styles.freshness} data-testid="soul-util-fresh">
      <Dot kind="ok" title={collectedAt} /> {ageText}
    </span>
  );
}

function SkewNote({ collectedAt, receivedAt }: { collectedAt?: string; receivedAt?: string }) {
  const { t } = useTranslation();
  const skew = skewMinutes(collectedAt, receivedAt);
  if (skew == null) return null;
  return <div className={styles.skew}>{t('souls:skewWarning', { minutes: skew })}</div>;
}

// Compact fitted tile for numeric detail — content-sized (flex), never clips the value.
function Detail({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.detail}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
      {sub ? <span className={styles.detailSub}>{sub}</span> : null}
    </div>
  );
}

const NATURAL_DIR: Record<DiskSortKey, SortDir> = { mount: 'asc', space: 'desc', inodes: 'desc' };

function DiskTable({ disks }: { disks?: TelemetryDisk[] | null }) {
  const { t } = useTranslation();
  // Default: busiest space on top. Click a header to sort by it; click again to toggle dir.
  const [sortKey, setSortKey] = useState<DiskSortKey>('space');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  if (!disks || disks.length === 0) return null;
  const rows = sortDisks(disks, sortKey, sortDir);

  function onSort(key: DiskSortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(NATURAL_DIR[key]);
    }
  }
  const ariaSort = (key: DiskSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <table className={common.table} style={{ marginTop: 12 }} data-testid="soul-util-disks">
      <thead>
        <tr>
          <SortHeader label={t('incarnations:utilMount')} col="mount" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('mount')} />
          <SortHeader label={t('incarnations:utilSpace')} col="space" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('space')} />
          <SortHeader label={t('incarnations:utilInodes')} col="inodes" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('inodes')} />
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const sp = ratioPct(d.used_mb, d.total_mb);
          const ino = inodePct(d.inodes_used, d.inodes_total);
          return (
            <tr key={d.mount}>
              <td className="mono">{d.mount}</td>
              <td className="mono">
                {formatMb(d.used_mb)} / {formatMb(d.total_mb)}{' '}
                <span className={styles.diskPct} style={{ color: toneColor(utilTone(sp)) }}>
                  ({formatPct(sp)})
                </span>
              </td>
              <td className="mono">
                {d.inodes_total > 0 ? (
                  <>
                    {d.inodes_used} / {d.inodes_total}{' '}
                    <span className={styles.diskPct} style={{ color: toneColor(utilTone(ino)) }}>
                      ({formatPct(ino)})
                    </span>
                  </>
                ) : (
                  'n/a'
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  col: DiskSortKey;
  active: DiskSortKey;
  dir: SortDir;
  onSort: (k: DiskSortKey) => void;
  ariaSort: 'ascending' | 'descending' | 'none';
}) {
  const isActive = active === col;
  return (
    <th
      scope="col"
      className={styles.sortTh}
      aria-sort={ariaSort}
      onClick={() => onSort(col)}
      data-testid={`soul-disk-th-${col}`}
    >
      {label}
      {isActive ? <span className={styles.caret}>{dir === 'asc' ? '▲' : '▼'}</span> : null}
    </th>
  );
}

function toneColor(tone: VitalsTone): string {
  if (tone === 'danger') return 'var(--danger)';
  if (tone === 'warn') return 'var(--warning)';
  return 'var(--text-faint)';
}

function WindowTrends({ window }: { window?: UtilizationWindowPoint[] | null }) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const win = [...(window ?? [])].reverse(); // API newest-first → chronological
  if (win.length === 0) {
    return (
      <div className={common.empty} data-testid="soul-util-window-empty" style={{ marginTop: 12 }}>
        {t('incarnations:utilWindowEmpty')}
      </div>
    );
  }

  const times = win.map((p) => p.collected_at);
  const cpu = win.map((p) => p.cpu_pct);
  const mem = win.map((p) => ratioPct(p.mem_used_mb, p.mem_total_mb) ?? 0);
  const load1 = win.map((p) => p.load1);
  const rx = win.map((p) => p.net_rx_bps);
  const tx = win.map((p) => p.net_tx_bps);

  const spanSec = spanSeconds(win[0].collected_at, win[win.length - 1].collected_at);
  const spanText = spanSec != null && spanSec > 0 ? `~${formatUptime(spanSec)}` : null;

  return (
    <div data-testid="soul-util-trends" style={{ marginTop: 12 }}>
      <div className={styles.trendsHead}>
        <span className={styles.trendsTitle}>{t('incarnations:utilTrends')}</span>
        <span className={styles.trendsSpan}>
          {win.length} samples{spanText ? ` · ${spanText}` : ''}
        </span>
      </div>
      <div className={styles.trendGrid}>
        <UtilTrend label={t('incarnations:utilCpu')} values={cpu} times={times} now={now} format={formatPct} min={0} max={100} tone={utilTone(minMaxLast(cpu)?.last)} testId="soul-trend-cpu" />
        <UtilTrend label={t('incarnations:utilMem')} values={mem} times={times} now={now} format={formatPct} min={0} max={100} tone={utilTone(minMaxLast(mem)?.last)} testId="soul-trend-mem" />
        <UtilTrend label={t('incarnations:utilLoadShort')} values={load1} times={times} now={now} format={formatLoad} tone="accent" testId="soul-trend-load" />
        <UtilTrend label={t('incarnations:utilNetRx')} values={rx} times={times} now={now} format={formatBps} axisFormat={formatBpsShort} min={0} tone="accent" testId="soul-trend-rx" />
        <UtilTrend label={t('incarnations:utilNetTx')} values={tx} times={times} now={now} format={formatBps} axisFormat={formatBpsShort} min={0} tone="accent" testId="soul-trend-tx" />
      </div>
    </div>
  );
}

// Overview priority strip — a compact row of stat cards (latest-only, curated). Renders
// nothing on unavailable/forbidden/error/no-latest, keeping the Overview clean. The
// freshness card ticks live via useNow.
export function SoulUtilizationStrip({ sid, enabled }: { sid: string; enabled: boolean }) {
  const { t } = useTranslation();
  const q = useSoulTelemetry(sid, enabled);
  const now = useNow(1000);
  const data = q.data;
  const l = data?.latest;

  if (!l) return null;

  const disk = busiestDisk(l.disks);
  const memPct = ratioPct(l.mem_used_mb, l.mem_total_mb);
  const stale = data?.stale ?? false;
  const age = ageSeconds(data?.collected_at, now);
  const freshText = stale ? 'stale' : age != null ? formatAgeShort(age) || 'now' : '—';

  return (
    <div className={styles.statRow} data-testid="soul-util-strip">
      <StatCard label={t('incarnations:utilCpu')} value={formatPct(l.cpu_pct)} pct={l.cpu_pct} tone={utilTone(l.cpu_pct)} />
      <StatCard label={t('incarnations:utilMem')} value={formatPct(memPct)} pct={memPct} tone={utilTone(memPct)} />
      <StatCard
        label={t('incarnations:utilDisk')}
        value={disk ? formatPct(disk.pct) : '—'}
        pct={disk?.pct ?? null}
        tone={utilTone(disk?.pct)}
        title={disk?.mount}
      />
      <StatCard label={t('incarnations:utilNet')} value={`↓ ${formatBps(l.net_rx_bps)}  ↑ ${formatBps(l.net_tx_bps)}`} />
      <StatCard label={t('incarnations:utilLoadShort')} value={formatLoad(l.load1)} />
      <div className={styles.statCard}>
        <span className={styles.statLabel}>{t('incarnations:utilFresh')}</span>
        <span className={styles.statFresh} title={data?.collected_at}>
          <Dot kind={stale ? 'warn' : 'ok'} /> {freshText}
        </span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  pct,
  tone,
  title,
}: {
  label: string;
  value: string;
  pct?: number | null;
  tone?: VitalsTone;
  title?: string;
}) {
  return (
    <div className={styles.statCard} title={title}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${tone ? tileTone[tone] : ''}`}>{value}</span>
      {pct != null ? (
        <div className={styles.statMeter}>
          <div
            className={`${styles.statMeterFill} ${meterTone[tone ?? 'ok']}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
