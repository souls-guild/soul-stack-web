import { utilTone, type VitalsTone } from '../incarnations/hostVitals';
import styles from './RadialGauge.module.css';

// Self-contained radial gauge (NIM-127, Grafana/Prometheus style). A 270° arc with
// the opening at the bottom; the value fills the arc proportionally and is colored by
// utilTone. Big number + label in the center. Pure inline SVG, theme-aware via CSS vars.
// Not the shared Sparkline — the incarnation panel is untouched.

const GAP_DEG = 90; // opening centered at the bottom (180°)
const SWEEP = 360 - GAP_DEG; // 270° of drawable track
// angle 0=top, 90=right, 180=bottom, 270=left (clockwise). Start at 225° (lower-left)
// and sweep 270° clockwise through left→top→right to 135° (lower-right) → gap at bottom.
const START = 180 + GAP_DEG / 2; // 225°

const toneVar: Record<VitalsTone, string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  danger: 'var(--danger)',
};

// angleDeg: 0 = top, 90 = right, 180 = bottom, 270 = left (clockwise).
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

interface Props {
  label: string;
  pct: number | null | undefined; // 0..100; null → n/a (empty arc)
  centerText?: string; // overrides the default "NN%" (e.g. to show n/a)
  sub?: string; // small caption under the value (e.g. mount, used/total)
  size?: number;
  testId?: string;
}

export function RadialGauge({ label, pct, centerText, sub, size = 116, testId }: Props) {
  const strokeW = Math.max(6, Math.round(size * 0.085));
  const r = size / 2 - strokeW / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  const valid = pct != null && Number.isFinite(pct);
  const clamped = valid ? Math.max(0, Math.min(100, pct)) : 0;
  const tone = utilTone(valid ? pct : null);
  const valueEnd = START + (SWEEP * clamped) / 100;
  const center = centerText ?? (valid ? `${Math.round(clamped)}%` : 'n/a');

  return (
    <div className={styles.gauge} style={{ width: size }} data-testid={testId}>
      <div className={styles.svgWrap} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${center}`}>
          <path className={styles.track} d={arcPath(cx, cy, r, START, START + SWEEP)} strokeWidth={strokeW} fill="none" />
          {valid && clamped > 0 ? (
            <path
              d={arcPath(cx, cy, r, START, valueEnd)}
              stroke={toneVar[tone]}
              strokeWidth={strokeW}
              strokeLinecap="round"
              fill="none"
            />
          ) : null}
        </svg>
        <div className={styles.center}>
          {/* Only the headline % lives inside the ring — the interior is too narrow for a caption. */}
          <span className={styles.value} style={{ color: valid ? toneVar[tone] : 'var(--text-faint)', fontSize: size * 0.24 }}>
            {center}
          </span>
        </div>
      </div>
      <div className={styles.caption}>
        <span className={styles.label}>{label}</span>
        {sub ? (
          <span className={styles.secondary} title={sub}>
            {sub}
          </span>
        ) : null}
      </div>
    </div>
  );
}
