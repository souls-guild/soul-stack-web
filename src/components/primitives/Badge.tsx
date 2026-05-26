import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

interface Props {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = 'muted', children }: Props) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
