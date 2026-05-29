import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Users,
  FileText,
  Terminal,
  Package,
  Puzzle,
  ShieldCheck,
  Eye,
  Scroll,
  Zap,
  Waves,
  Send,
  Play,
  Activity,
  HelpCircle,
} from 'lucide-react';
import { SidebarToggleIcon } from '../icons/SidebarToggleIcon';
import { HelpModal } from './HelpModal';
import styles from './Sidebar.module.css';

// Sidebar — primary navigation.
//
// UX-pattern: один entry-point для запуска работы (/run Wizard),
// остальные pages — read-only views (registry / history / audit).
//
// Routes /errands/new + /push сохранены как hidden для
// backward-compat-ссылок (deprecated, см. PM-decision 2026-05-27).

interface NavItem {
  to: string;
  label: string;
  icon: typeof Boxes;
  disabled?: boolean;
  // Если задан — link активен и при префиксе (для вложенных подвкладок).
  matchPrefix?: string;
}

const PRIMARY: NavItem[] = [
  { to: '/run', label: 'Run', icon: Play, matchPrefix: '/run' },
];

const REGISTRY: NavItem[] = [
  { to: '/archons', label: 'Archons', icon: Users, matchPrefix: '/archons' },
  { to: '/services', label: 'Services', icon: Package },
  { to: '/incarnations', label: 'Incarnations', icon: Boxes },
  { to: '/souls', label: 'Souls', icon: Users },
  { to: '/plugins', label: 'Plugins', icon: Puzzle, matchPrefix: '/plugins' },
  { to: '/rbac', label: 'RBAC', icon: ShieldCheck },
];

const ORACLE: NavItem[] = [
  { to: '/vigils', label: 'Vigils', icon: Eye, matchPrefix: '/vigils' },
  { to: '/decrees', label: 'Decrees', icon: Scroll, matchPrefix: '/decrees' },
  { to: '/oracle/fires', label: 'Oracle fires', icon: Zap, matchPrefix: '/oracle' },
];

// History-навигация. Основной вход для ad-hoc-команд — ErrandRuns («Command runs»):
// запуск команды на N хостов (ULID). Per-host Errand — drill-down внутри
// ErrandRun-detail; standalone /errands оставлен как route (single-host exec log,
// ссылки с soul/audit), но из верхнего History убран, чтобы вход был однозначным.
const HISTORY: NavItem[] = [
  { to: '/runs', label: 'All runs', icon: Activity, matchPrefix: '/runs' },
  { to: '/tides', label: 'Tides', icon: Waves, matchPrefix: '/tides' },
  { to: '/errand-runs', label: 'Command runs', icon: Terminal, matchPrefix: '/errand-runs' },
  { to: '/push-runs', label: 'Push runs', icon: Send, matchPrefix: '/push-runs' },
];

const BOTTOM: NavItem[] = [
  { to: '/audit', label: 'Audit log', icon: FileText },
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
      {PRIMARY.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>Registry</div>}
      {REGISTRY.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>Oracle</div>}
      {ORACLE.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>Runs</div>}
      {HISTORY.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}

      <div className={styles.bottom}>
        <div className={styles.divider} aria-hidden="true" />
        {BOTTOM.map((it) => (
          <Item key={it.to} item={it} collapsed={collapsed} />
        ))}
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
