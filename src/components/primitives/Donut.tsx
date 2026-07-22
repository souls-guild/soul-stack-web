import styles from './Donut.module.css';

export type DonutTone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'accent';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  tone?: DonutTone;
}

interface Props {
  slices: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string | number;
  emptyLabel?: string;
}

const toneClass: Record<DonutTone, string> = {
  ok: styles.ok,
  warn: styles.warn,
  danger: styles.danger,
  info: styles.info,
  muted: styles.muted,
  accent: styles.accent,
};

// Donut chart in plain SVG (no chart library - the only
// consumer right now is Souls Overview, pulling in recharts for one page
// isn't justified). Each slice is its own <circle> with stroke-dasharray,
// an accumulated offset moves the segments around the circle without overlap.
export function Donut({
  slices,
  size = 160,
  strokeWidth = 20,
  centerLabel,
  centerValue,
  emptyLabel,
}: Props) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let accumulated = 0;

  return (
    <div className={styles.wrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.svg}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        {total > 0
          ? slices
              .filter((s) => s.value > 0)
              .map((s) => {
                const fraction = s.value / total;
                const dash = fraction * circumference;
                const offset = circumference * (1 - accumulated);
                accumulated += fraction;
                return (
                  <circle
                    key={s.key}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    className={toneClass[s.tone ?? 'muted']}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${center} ${center})`}
                    data-testid={`donut-slice-${s.key}`}
                  >
                    <title>{`${s.label}: ${s.value}`}</title>
                  </circle>
                );
              })
          : null}
        <text x={center} y={center - (centerLabel ? 6 : 0)} textAnchor="middle" className={styles.centerValue}>
          {total > 0 ? (centerValue ?? total) : (emptyLabel ?? '—')}
        </text>
        {centerLabel && total > 0 ? (
          <text x={center} y={center + 16} textAnchor="middle" className={styles.centerLabel}>
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className={styles.legend}>
        {slices.map((s) => (
          <li key={s.key} className={styles.legendItem}>
            <span className={`${styles.legendDot} ${toneClass[s.tone ?? 'muted']}`} />
            <span className={styles.legendLabel}>{s.label}</span>
            <span className={styles.legendValue}>{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
