import { useState, type MouseEvent } from 'react';
import {
  ageSeconds,
  axisTicks,
  formatAgeShort,
  formatClock,
  minMaxLast,
  nearestIndex,
  type VitalsTone,
} from '../pages/incarnations/hostVitals';
import styles from './UtilTrend.module.css';

// Shared richer trend chart (NIM-127) — a real mini-chart, not a bare strip: line + a
// marker dot at every sample, a highlighted current point, an approximate y-axis (3 faint
// gridlines + left-gutter value labels over the plotted min..max range), and a hover tooltip
// that snaps to the nearest sample (timestamp + value). Self-contained inline SVG; distinct
// from the primitives' Sparkline (used by the incarnation panel), which stays untouched.
// Lives in components/ so both the soul page and the incarnation panel can reuse it.

const W = 200;
const H = 72;
const AXIS_W = 42; // left gutter (viewBox units) — wide enough for compact axis labels
const PAD_X = 3;
const PAD_Y = 7;
const PLOT_L = AXIS_W;
const PLOT_R = W - PAD_X;

const toneStroke: Record<VitalsTone | 'accent', string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

interface Props {
  label: string;
  values: number[]; // chronological (old → new)
  format: (n: number | null | undefined) => string;
  axisFormat?: (n: number | null | undefined) => string; // terse variant for axis labels (defaults to format)
  times?: string[]; // collected_at per value (aligned with `values`), for the hover tooltip
  now?: number; // epoch ms for relative age in the tooltip
  min?: number; // fixed domain (e.g. 0..100 for %)
  max?: number;
  tone?: VitalsTone | 'accent';
  testId?: string;
}

export function UtilTrend({ label, values, format, axisFormat, times, now, min, max, tone = 'accent', testId }: Props) {
  const fmtAxis = axisFormat ?? format;
  const [hover, setHover] = useState<number | null>(null);

  // Keep the sample timestamp aligned with its value even if some values are non-finite.
  const samples = values
    .map((v, i) => ({ v, t: times?.[i] }))
    .filter((s) => Number.isFinite(s.v));
  const pts = samples.map((s) => s.v);
  const stats = minMaxLast(values);
  const lo = min ?? (stats ? stats.min : 0);
  const hi = max ?? (stats ? stats.max : 1);
  const span = hi - lo || 1;
  const innerW = PLOT_R - PLOT_L;
  const innerH = H - PAD_Y * 2;
  const stroke = toneStroke[tone];

  const xOf = (i: number) => PLOT_L + (pts.length > 1 ? (i / (pts.length - 1)) * innerW : innerW / 2);
  const yOf = (v: number) => {
    const c = Math.max(lo, Math.min(hi, v));
    return PAD_Y + innerH - ((c - lo) / span) * innerH;
  };
  const coords = pts.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
  const lastX = pts.length ? xOf(pts.length - 1) : (PLOT_L + PLOT_R) / 2;
  const lastY = pts.length ? yOf(pts[pts.length - 1]) : H / 2;

  // Approximate y-axis: max (top) / midpoint / min (bottom) of the plotted range.
  const ticks = axisTicks(lo, hi);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    if (pts.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // px → viewBox x → fraction across the plot area (excludes the label gutter).
    const xView = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * W : NaN;
    const frac = (xView - PLOT_L) / innerW;
    setHover(nearestIndex(pts.length, frac));
  }

  const hovered = hover != null && hover < pts.length ? hover : null;
  const hoverX = hovered != null ? xOf(hovered) : 0;
  const hoverTime = hovered != null ? samples[hovered].t : undefined;
  const hoverAge = formatAgeShort(ageSeconds(hoverTime, now ?? Date.now()));
  const hoverLeftPct = Math.max((AXIS_W / 2 / W) * 100, Math.min(94, (hoverX / W) * 100));

  return (
    <div className={styles.trend} data-testid={testId}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.now} style={{ color: stroke }}>
          {stats ? format(stats.last) : '—'}
        </span>
      </div>
      <div className={styles.plot}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          role="img"
          aria-label={`${label} ${stats ? format(stats.last) : ''}`}
          data-points={pts.length}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((v, i) => {
            const y = yOf(v);
            return (
              <g key={i}>
                <line className={styles.grid} x1={PLOT_L} y1={y} x2={PLOT_R} y2={y} />
                <text className={styles.axisLabel} x={AXIS_W - 4} y={y} textAnchor="end" dominantBaseline="middle">
                  {fmtAxis(v)}
                </text>
              </g>
            );
          })}
          {pts.length > 1 ? (
            <polyline className={styles.line} points={coords.join(' ')} stroke={stroke} fill="none" />
          ) : null}
          {pts.map((v, i) => (
            <circle key={i} cx={xOf(i)} cy={yOf(v)} r={1.5} fill={stroke} opacity={0.55} />
          ))}
          {pts.length ? <circle cx={lastX} cy={lastY} r={2.6} fill={stroke} /> : null}
          {hovered != null ? (
            <>
              <line className={styles.guide} x1={hoverX} y1={PAD_Y} x2={hoverX} y2={H - PAD_Y} />
              <circle className={styles.hoverRing} cx={hoverX} cy={yOf(pts[hovered])} r={3.6} fill={stroke} />
            </>
          ) : null}
        </svg>
        {hovered != null ? (
          <div className={styles.tooltip} style={{ left: `${hoverLeftPct}%` }} data-testid="soul-trend-tooltip">
            <span className={styles.tipValue} style={{ color: stroke }}>
              {format(pts[hovered])}
            </span>
            <span className={styles.tipTime}>
              {formatClock(hoverTime)}
              {hoverAge ? ` · ${hoverAge}` : ''}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
