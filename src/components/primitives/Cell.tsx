import type { ReactNode } from 'react';
import styles from './Cell.module.css';
import { Dot, type DotKind } from './Dot';

type Mood = 'ok' | 'alert' | 'offline';

interface Props {
  name: string;
  value: ReactNode;
  label?: string;
  meta?: string;
  mood?: Mood;
  dot?: DotKind;
}

const moodClass: Record<Mood, string> = {
  ok: '',
  alert: styles.alert,
  offline: styles.offline,
};

export function Cell({ name, value, label, meta, mood = 'ok', dot }: Props) {
  const composed = [styles.cell, moodClass[mood]].filter(Boolean).join(' ');
  return (
    <div className={composed}>
      <div className={styles.top}>
        <span className={styles.name}>{name}</span>
        {dot ? <Dot kind={dot} /> : null}
      </div>
      <div className={styles.num}>
        <span className={styles.val}>{value}</span>
        {label ? <span className={styles.lbl}>{label}</span> : null}
      </div>
      {meta ? <div className={styles.meta}>{meta}</div> : null}
    </div>
  );
}
