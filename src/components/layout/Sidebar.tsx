import { NavLink } from 'react-router-dom';
import { Boxes, Users, ScrollText } from 'lucide-react';
import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Boxes;
  disabled?: boolean;
}

const FLEET: NavItem[] = [
  { to: '/incarnations', label: 'Incarnations', icon: Boxes },
  { to: '/souls', label: 'Souls', icon: Users },
];

const OPS: NavItem[] = [
  { to: '/audit', label: 'Audit', icon: ScrollText, disabled: true },
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
