import type { TelemetryDisk } from '../../api/keeper';

// Чистые форматтеры/пороги host-vitals (NIM-88). Без React/i18n — тестируются юнитом.

export type VitalsTone = 'ok' | 'warn' | 'danger';

// Skew collected_at↔received_at (ADR-018): > 10 мин → возможен NTP-дрейф.
const SKEW_WARN_MS = 10 * 60 * 1000;

// Окраска утилизации: < 70% ok, < 90% warn, иначе danger.
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

// load-average → 2 знака; прочерк на nil/NaN (защита от частичного latest старого агента).
export function formatLoad(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

// МБ → человекочитаемо: < 1024 МБ как MB, иначе GB с 1 знаком.
export function formatMb(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return '—';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// uptime сек → компактно d/h/m/s (единицы технические, не локализуются).
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

// Самый загруженный диск (max used%). null если дисков нет/все невалидны.
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

// Skew в минутах, если > порога; иначе null. Зеркалит SoulDetail.skewWarning.
export function skewMinutes(collectedAt?: string, receivedAt?: string): number | null {
  if (!collectedAt || !receivedAt) return null;
  const a = new Date(collectedAt).getTime();
  const b = new Date(receivedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const diff = Math.abs(b - a);
  if (diff <= SKEW_WARN_MS) return null;
  return Math.floor(diff / 60000);
}

// Возраст снимка в секундах (>= 0) от nowMs. null если метки нет/битая.
export function ageSeconds(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}
