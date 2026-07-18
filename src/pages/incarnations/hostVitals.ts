import type { TelemetryDisk } from '../../api/keeper';

// Pure host-vitals formatters/thresholds (NIM-88). No React/i18n — unit-tested.

export type VitalsTone = 'ok' | 'warn' | 'danger';

// Skew collected_at↔received_at (ADR-018): > 10 min → possible NTP drift.
const SKEW_WARN_MS = 10 * 60 * 1000;

// Utilization coloring: < 70% ok, < 90% warn, otherwise danger.
export function utilTone(pct: number | null | undefined): VitalsTone {
  if (pct == null || Number.isNaN(pct)) return 'ok';
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'ok';
}

export function ratioPct(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

export function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Math.round(v)}%`;
}

// load-average → 2 decimals; dash on nil/NaN (guards against a partial latest from an old agent).
export function formatLoad(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

// MB → human-readable: < 1024 MB as MB, otherwise GB with 1 decimal.
export function formatMb(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return '—';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// uptime sec → compact d/h/m/s (units are technical, not localized).
export function formatUptime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Busiest disk (max used%). null if there are no disks / all are invalid.
export function busiestDisk(
  disks: TelemetryDisk[] | null | undefined,
): { mount: string; pct: number } | null {
  if (!disks || disks.length === 0) return null;
  let top: { mount: string; pct: number } | null = null;
  for (const d of disks) {
    const p = ratioPct(d.used_mb, d.total_mb);
    if (p == null) continue;
    if (!top || p > top.pct) top = { mount: d.mount, pct: p };
  }
  return top;
}

// Network throughput bytes/sec → human-readable rate (NIM-127). Dash on nil/NaN/<0.
export function formatBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return '—';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bps / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
}

// Terse throughput for tight axis labels (NIM-127): KB/s rounded to an integer (e.g.
// "484 KB/s" not "483.2 KB/s"); MB/s & GB/s keep 1 decimal. Dash on nil/NaN/<0. The hover
// tooltip keeps the precise formatBps.
export function formatBpsShort(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return '—';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${Math.round(bps / 1024)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bps / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
}

// Inode usage percent (NIM-127); null when the FS reports no inodes (total<=0) → UI "n/a".
export function inodePct(used: number, total: number): number | null {
  return ratioPct(used, total);
}

// Busiest inode mount (max inode used%). null if no mount reports inodes.
export function busiestInode(
  disks: TelemetryDisk[] | null | undefined,
): { mount: string; pct: number } | null {
  if (!disks || disks.length === 0) return null;
  let top: { mount: string; pct: number } | null = null;
  for (const d of disks) {
    const p = inodePct(d.inodes_used ?? 0, d.inodes_total ?? 0);
    if (p == null) continue;
    if (!top || p > top.pct) top = { mount: d.mount, pct: p };
  }
  return top;
}

// Skew in minutes if > threshold; otherwise null. Mirrors SoulDetail.skewWarning.
export function skewMinutes(collectedAt?: string, receivedAt?: string): number | null {
  if (!collectedAt || !receivedAt) return null;
  const a = new Date(collectedAt).getTime();
  const b = new Date(receivedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const diff = Math.abs(b - a);
  if (diff <= SKEW_WARN_MS) return null;
  return Math.floor(diff / 60000);
}

// Snapshot age in seconds (>= 0) from nowMs. null if the timestamp is missing/broken.
export function ageSeconds(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

// min/max/current for a trend series (NIM-127 soul chart). Ignores non-finite
// samples; null when the series has no finite point. `last` is the newest finite value.
export function minMaxLast(values: number[]): { min: number; max: number; last: number } | null {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length === 0) return null;
  return { min: Math.min(...pts), max: Math.max(...pts), last: pts[pts.length - 1] };
}

// Span in seconds between two ISO timestamps (absolute). null if either is missing/broken.
// Used to label how much wall-clock the trend window covers.
export function spanSeconds(aIso?: string, bIso?: string): number | null {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round(Math.abs(b - a) / 1000));
}

// Nearest sample index for a mouse position (NIM-127 trend hover). `frac` is 0..1 along
// the chart width; snaps to the closest of `count` samples. NaN/empty → index 0 (safe in
// jsdom where getBoundingClientRect is zero-sized).
export function nearestIndex(count: number, frac: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(frac)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(frac * (count - 1))));
}

// ISO → "HH:MM:SS" (UTC, matches the UTC collected_at timestamps). Dash on missing/broken.
export function formatClock(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// Compact "N{s|m|h|d} ago" (structural English, no i18n). Empty string on nil/NaN/<0.
export function formatAgeShort(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Three approximate y-axis ticks [top, middle, bottom] for the plotted lo..hi range
// (NIM-127 trend axis). Top = hi (max), bottom = lo (min), middle = midpoint. Raw values;
// the caller formats+rounds per metric. Degenerate lo==hi → three equal ticks.
export function axisTicks(lo: number, hi: number): [number, number, number] {
  return [hi, (lo + hi) / 2, lo];
}

export type DiskSortKey = 'mount' | 'space' | 'inodes';
export type SortDir = 'asc' | 'desc';

// Disk-table comparator (NIM-127). Copy — never mutates the input. `mount` sorts
// alphabetically; `space`/`inodes` sort by used% / inode% with invalid-metric rows
// (total<=0 / inodes_total<=0 → "n/a") always sinking to the bottom regardless of dir.
// Ties break alphabetically by mount for deterministic order.
export function sortDisks(
  disks: TelemetryDisk[] | null | undefined,
  key: DiskSortKey,
  dir: SortDir,
): TelemetryDisk[] {
  if (!disks) return [];
  const arr = [...disks];
  const mul = dir === 'asc' ? 1 : -1;
  if (key === 'mount') {
    return arr.sort((a, b) => mul * a.mount.localeCompare(b.mount));
  }
  const metric = (d: TelemetryDisk) =>
    key === 'space' ? ratioPct(d.used_mb, d.total_mb) : inodePct(d.inodes_used, d.inodes_total);
  return arr.sort((a, b) => {
    const pa = metric(a);
    const pb = metric(b);
    if (pa == null && pb == null) return a.mount.localeCompare(b.mount);
    if (pa == null) return 1; // invalid always last
    if (pb == null) return -1;
    if (pa === pb) return a.mount.localeCompare(b.mount);
    return mul * (pa - pb);
  });
}

// Disks sorted by used% descending (busiest on top). Thin wrapper over sortDisks.
export function sortDisksByUsage(disks: TelemetryDisk[] | null | undefined): TelemetryDisk[] {
  return sortDisks(disks, 'space', 'desc');
}

export type HostSortKey = 'host' | 'status' | 'cpu' | 'mem' | 'disk' | 'net' | 'load' | 'uptime' | 'fresh';

// Sort-relevant projection of a unified host row (connected soul ⋈ utilization). Numeric
// fields are null when the host has no telemetry yet — those rows always sink to the bottom
// on util-column sorts, regardless of direction. `ageSec` is the snapshot age (bigger = staler).
export interface HostVitalsRow {
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

// Unified hosts-table comparator (NIM-127). Copy — never mutates the input. `host`/`status`
// sort by string; the numeric columns sort by their metric with no-util / invalid-metric rows
// (null) always sinking to the bottom. Ties break alphabetically by SID for a stable order.
export function sortHostRows<T extends HostVitalsRow>(rows: T[], key: HostSortKey, dir: SortDir): T[] {
  const arr = [...rows];
  const mul = dir === 'asc' ? 1 : -1;
  if (key === 'host') return arr.sort((a, b) => mul * a.sid.localeCompare(b.sid));
  if (key === 'status') {
    return arr.sort((a, b) => mul * (a.status.localeCompare(b.status) || 0) || a.sid.localeCompare(b.sid));
  }
  const metric = (r: T): number | null => {
    switch (key) {
      case 'cpu':
        return r.cpu;
      case 'mem':
        return r.memPct;
      case 'disk':
        return r.diskPct;
      case 'net':
        return r.net;
      case 'load':
        return r.load1;
      case 'uptime':
        return r.uptime;
      case 'fresh':
        return r.ageSec;
      default:
        return null;
    }
  };
  return arr.sort((a, b) => {
    const pa = metric(a);
    const pb = metric(b);
    if (pa == null && pb == null) return a.sid.localeCompare(b.sid);
    if (pa == null) return 1; // no-util / invalid metric always sinks to the bottom
    if (pb == null) return -1;
    if (pa === pb) return a.sid.localeCompare(b.sid);
    return mul * (pa - pb);
  });
}
