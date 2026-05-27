import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Users,
  ScrollText,
  FileText,
  Upload,
  Terminal,
  Package,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
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
  { to: '/services', label: 'Services', icon: Package },
];

const OPS: NavItem[] = [
  { to: '/audit', label: 'Audit', icon: FileText },
  { to: '/archons', label: 'Archons', icon: Users },
  { to: '/rbac', label: 'RBAC', icon: ShieldCheck },
  { to: '/push', label: 'Push', icon: Upload },
  { to: '/errand/exec', label: 'Errand · exec', icon: Terminal, matchPrefix: '/errand/exec' },
  { to: '/errand/history', label: 'Errand · history', icon: ScrollText, matchPrefix: '/errand/history' },
];

interface ItemProps {
  item: NavItem;
  collapsed: boolean;
}

function Item({ item, collapsed }: ItemProps) {
  const Icon = item.icon;
  const titleAttr = collapsed ? item.label : undefined;
  if (item.disabled) {
    return (
      <span
        className={`${styles.link} ${styles.disabled}`}
        aria-disabled="true"
        title={titleAttr}
      >
        <span className={styles.icon}>
          <Icon size={16} />
        </span>
        {collapsed ? null : <span className={styles.label}>{item.label}</span>}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      title={titleAttr}
      className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
    >
      <span className={styles.icon}>
        <Icon size={16} />
      </span>
      {collapsed ? null : <span className={styles.label}>{item.label}</span>}
    </NavLink>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <nav
      className={collapsed ? `${styles.sidebar} ${styles.collapsed}` : styles.sidebar}
      aria-label="Основная навигация"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {collapsed ? null : <div className={styles.group}>Реестр</div>}
      {FLEET.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>Операции</div>}
      {OPS.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      <button
        type="button"
        className={styles.toggle}
        onClick={onToggle}
        aria-label={collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Развернуть' : 'Свернуть'}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        {collapsed ? null : <span className={styles.toggleLabel}>Свернуть</span>}
      </button>
    </nav>
  );
}
