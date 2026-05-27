import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Users,
  FileText,
  Upload,
  Terminal,
  Package,
  Puzzle,
  ShieldCheck,
  Eye,
  Scroll,
  Zap,
  HelpCircle,
} from 'lucide-react';
import { SidebarToggleIcon } from '../icons/SidebarToggleIcon';
import { HelpModal } from './HelpModal';
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
  { to: '/plugins', label: 'Plugins', icon: Puzzle, matchPrefix: '/plugins' },
];

const OPS: NavItem[] = [
  { to: '/audit', label: 'Audit', icon: FileText },
  { to: '/archons', label: 'Archons', icon: Users },
  { to: '/rbac', label: 'RBAC', icon: ShieldCheck },
  { to: '/push', label: 'Push', icon: Upload },
  { to: '/errands', label: 'Errands', icon: Terminal, matchPrefix: '/errands' },
];

const ORACLE: NavItem[] = [
  { to: '/vigils', label: 'Vigils', icon: Eye, matchPrefix: '/vigils' },
  { to: '/decrees', label: 'Decrees', icon: Scroll, matchPrefix: '/decrees' },
  { to: '/oracle/fires', label: 'Oracle fires', icon: Zap, matchPrefix: '/oracle' },
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
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <nav
      className={collapsed ? `${styles.sidebar} ${styles.collapsed}` : styles.sidebar}
      aria-label="Основная навигация"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={styles.toggleRow}>
        {collapsed ? (
          <div className={styles.logoMarkOnly} aria-label="Soul Stack" title="Soul Stack">
            <Boxes size={16} />
          </div>
        ) : (
          <div className={styles.logo} aria-label="Soul Stack">
            <span className={styles.logoMark}><Boxes size={16} /></span>
            <span className={styles.logoText}>Soul Stack</span>
          </div>
        )}
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          aria-label={collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          <SidebarToggleIcon size={18} collapsed={collapsed} />
        </button>
      </div>
      {collapsed ? null : <div className={styles.group}>Реестр</div>}
      {FLEET.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>Операции</div>}
      {OPS.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>Oracle</div>}
      {ORACLE.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}

      <div className={styles.bottom}>
        <div className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={`${styles.link} ${styles.helpBtn}`}
          onClick={() => setHelpOpen(true)}
          title={collapsed ? 'Помощь' : undefined}
          aria-label="Помощь"
        >
          <span className={styles.icon}>
            <HelpCircle size={16} />
          </span>
          {collapsed ? null : <span className={styles.label}>Помощь</span>}
        </button>
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </nav>
  );
}
