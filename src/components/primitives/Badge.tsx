import type { ReactNode } from 'react';
import styles from './Badge.module.css';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

interface Props {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = 'muted', children, title }: Props) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      {children}
    </span>
  );
}
