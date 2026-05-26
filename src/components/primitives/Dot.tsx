import styles from './Dot.module.css';

export type DotKind = 'ok' | 'warn' | 'off' | 'info' | 'idle';

interface Props {
  kind: DotKind;
  title?: string;
}

export function Dot({ kind, title }: Props) {
  return <span className={`${styles.dot} ${styles[kind]}`} title={title} aria-label={title ?? kind} />;
}
