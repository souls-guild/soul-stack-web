import styles from './JsonViewer.module.css';

interface Props {
  value: unknown;
  emptyLabel?: string;
}

export function JsonViewer({ value, emptyLabel = 'empty' }: Props) {
  if (value === null || value === undefined) {
    return <div className={styles.viewer}><span className={styles.empty}>{emptyLabel}</span></div>;
  }
  if (typeof value === 'object' && Object.keys(value as object).length === 0) {
    return <div className={styles.viewer}><span className={styles.empty}>{emptyLabel}</span></div>;
  }
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <div className={styles.viewer}>
      <pre className={styles.pre}>{text}</pre>
    </div>
  );
}
