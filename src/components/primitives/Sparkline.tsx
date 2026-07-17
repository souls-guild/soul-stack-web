import styles from './Sparkline.module.css';

export type SparklineTone = 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

interface Props {
  values: number[]; // хронологически (старые → новые)
  width?: number;
  height?: number;
  min?: number; // фиксированный домен (напр. 0..100 для %); иначе по значениям
  max?: number;
  tone?: SparklineTone;
  ariaLabel?: string;
  testId?: string;
}

const toneClass: Record<SparklineTone, string> = {
  ok: styles.ok,
  warn: styles.warn,
  danger: styles.danger,
  accent: styles.accent,
  muted: styles.muted,
};

// Спарклайн на чистом SVG (без chart-библиотеки, паттерн Donut). Точки вне домена
// клампятся; 1 точка → маркер по центру; пусто → пустой svg (потребитель решает).
export function Sparkline({
  values,
  width = 132,
  height = 30,
  min,
  max,
  tone = 'accent',
  ariaLabel,
  testId,
}: Props) {
  const pts = values.filter((v) => Number.isFinite(v));
  const lo = min ?? (pts.length ? Math.min(...pts) : 0);
  const hi = max ?? (pts.length ? Math.max(...pts) : 1);
  const span = hi - lo || 1;
  const pad = 2;
  const inner = height - pad * 2;
  const yOf = (v: number) => {
    const clamped = Math.max(lo, Math.min(hi, v));
    return pad + inner - ((clamped - lo) / span) * inner;
  };
  const stepX = pts.length > 1 ? width / (pts.length - 1) : 0;
  const coords = pts.map((v, i) => `${(i * stepX).toFixed(1)},${yOf(v).toFixed(1)}`);
  const lastX = pts.length > 1 ? (pts.length - 1) * stepX : width / 2;
  const lastY = pts.length ? yOf(pts[pts.length - 1]) : height / 2;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.svg}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      data-points={pts.length}
    >
      {pts.length > 1 ? (
        <polyline className={`${styles.line} ${toneClass[tone]}`} points={coords.join(' ')} />
      ) : null}
      {pts.length >= 1 ? (
        <circle className={`${styles.dot} ${toneClass[tone]}`} cx={lastX} cy={lastY} r={1.8} />
      ) : null}
      {ariaLabel ? <title>{ariaLabel}</title> : null}
    </svg>
  );
}
