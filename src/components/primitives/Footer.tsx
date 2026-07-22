import styles from './Footer.module.css';

interface Props {
  brand: string;
  status: string;
  mood?: 'ok' | 'warn';
}

export function Footer({ brand, status, mood = 'ok' }: Props) {
  const composed = [styles.footer, mood === 'warn' ? styles.warn : ''].filter(Boolean).join(' ');
  return (
    <footer className={composed}>
      <span>{brand}</span>
      <span className={styles.live}>
        <span className={styles.liveDot} />
        {status}
      </span>
    </footer>
  );
}
