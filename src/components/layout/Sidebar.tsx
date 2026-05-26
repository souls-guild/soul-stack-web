import { NavLink } from 'react-router-dom';
import { Boxes, Users, ScrollText, FileText, Upload, Terminal } from 'lucide-react';
import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Boxes;
  disabled?: boolean;
  // Если задан — link активен и при префиксе (для вложенных подвкладок).
  matchPrefix?: string;
}

const FLEET: NavItem[] = [
  { to: '/incarnations', label: 'Incarnations', icon: Boxes },
  { to: '/souls', label: 'Souls', icon: Users },
];

const OPS: NavItem[] = [
  { to: '/audit', label: 'Audit', icon: FileText },
  { to: '/archons', label: 'Archons', icon: Users },
  { to: '/push', label: 'Push', icon: Upload },
  { to: '/errand/exec', label: 'Errand · exec', icon: Terminal, matchPrefix: '/errand/exec' },
  { to: '/errand/history', label: 'Errand · history', icon: ScrollText, matchPrefix: '/errand/history' },
];

function Item({ item }: { item: NavItem }) {
  const Icon = item.icon;
  if (item.disabled) {
    return (
      <span className={`${styles.link} ${styles.disabled}`} aria-disabled="true">
        <span className={styles.icon}>
          <Icon size={16} />
        </span>
        {item.label}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
    >
      <span className={styles.icon}>
        <Icon size={16} />
      </span>
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Основная навигация">
      <div className={styles.group}>Реестр</div>
      {FLEET.map((it) => (
        <Item key={it.to} item={it} />
      ))}
      <div className={styles.group}>Операции</div>
      {OPS.map((it) => (
        <Item key={it.to} item={it} />
      ))}
    </nav>
  );
}
