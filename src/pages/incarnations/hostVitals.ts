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
