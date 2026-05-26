import type { ReactNode } from 'react';
import { Footer } from '../primitives';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import styles from './Shell.module.css';

interface Props {
  children: ReactNode;
}

export function Shell({ children }: Props) {
  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>
        <Topbar />
      </div>
      <aside className={styles.sidebar}>
        <Sidebar />
      </aside>
      <main className={styles.main}>{children}</main>
      <div className={styles.footerWrap}>
        <Footer brand="Soul Stack · Keeper UI v0.1.0-pilot" status="Connected to Keeper" />
      </div>
    </div>
  );
}
