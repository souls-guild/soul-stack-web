import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import {
  Boxes,
  Users,
  Users2,
  FileText,
  LayoutDashboard,
  Package,
  Puzzle,
  Cloud,
  ShieldCheck,
  Eye,
  Scroll,
  Zap,
  Play,
  Activity,
  HelpCircle,
  CalendarClock,
  Bell,
  Settings,
} from 'lucide-react';
import { SidebarToggleIcon } from '../icons/SidebarToggleIcon';
import { HelpModal } from './HelpModal';
import styles from './Sidebar.module.css';

// Sidebar — primary navigation.
//
// UX-pattern: one entry-point for launching work (/run Wizard),
// the rest of the pages are read-only views (registry / history / audit).
//
// Routes /errands/new + /push + /push-runs (+ /push-runs/:applyId)
// are kept hidden for backward-compat links (deprecated,
// see PM-decision 2026-05-27). Push deferred - no use-case, pull
// covers everything; the /v1/push-runs endpoint isn't registered
// in the dev-config (404), so the item was removed from navigation.

interface NavItem {
  to: string;
  // Key in the `common` namespace; entity-name items resolve to the same
  // English word in every locale (see the i18n translation rule in CLAUDE.md).
  labelKey: string;
  icon: typeof Boxes;
  disabled?: boolean;
  // If set - the link is active on prefix match too (for nested sub-tabs).
  matchPrefix?: string;
}

const PRIMARY: NavItem[] = [
  { to: '/overview', labelKey: 'navOverview', icon: LayoutDashboard },
  { to: '/run', labelKey: 'navRun', icon: Play, matchPrefix: '/run' },
];

const REGISTRY: NavItem[] = [
  { to: '/archons', labelKey: 'navArchons', icon: Users, matchPrefix: '/archons' },
  { to: '/services', labelKey: 'navServices', icon: Package },
  { to: '/incarnations', labelKey: 'navIncarnations', icon: Boxes },
  { to: '/souls', labelKey: 'navSouls', icon: Users },
  { to: '/plugins', labelKey: 'navPlugins', icon: Puzzle, matchPrefix: '/plugins' },
  { to: '/providers', labelKey: 'navProviders', icon: Cloud, matchPrefix: '/providers' },
  { to: '/rbac', labelKey: 'navRbac', icon: ShieldCheck },
  { to: '/synods', labelKey: 'navSynods', icon: Users2, matchPrefix: '/synods' },
];

const ORACLE: NavItem[] = [
  { to: '/vigils', labelKey: 'navVigils', icon: Eye, matchPrefix: '/vigils' },
  { to: '/decrees', labelKey: 'navDecrees', icon: Scroll, matchPrefix: '/decrees' },
  { to: '/oracle/fires', labelKey: 'navOracleFires', icon: Zap, matchPrefix: '/oracle' },
];

const HISTORY: NavItem[] = [
  { to: '/runs', labelKey: 'navAllRuns', icon: Activity, matchPrefix: '/runs' },
  { to: '/cadences', labelKey: 'navCadences', icon: CalendarClock, matchPrefix: '/cadences' },
];

const BOTTOM: NavItem[] = [
  { to: '/audit', labelKey: 'navAuditLog', icon: FileText },
  { to: '/notifications', labelKey: 'navNotifications', icon: Bell, matchPrefix: '/notifications' },
  { to: '/settings', labelKey: 'navSettings', icon: Settings, matchPrefix: '/settings' },
];

interface ItemProps {
  item: NavItem;
  collapsed: boolean;
}

function Item({ item, collapsed }: ItemProps) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.labelKey);
  const titleAttr = collapsed ? label : undefined;
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
        {collapsed ? null : <span className={styles.label}>{label}</span>}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      title={titleAttr}
      // end=false when matchPrefix is set - the link is active on all nested routes.
      end={!item.matchPrefix}
      className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
    >
      <span className={styles.icon}>
        <Icon size={16} />
      </span>
      {collapsed ? null : <span className={styles.label}>{label}</span>}
    </NavLink>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <nav
      className={collapsed ? `${styles.sidebar} ${styles.collapsed}` : styles.sidebar}
      aria-label={t('sidebarNav')}
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
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          aria-expanded={!collapsed}
          title={collapsed ? t('expand') : t('collapse')}
        >
          <SidebarToggleIcon size={18} collapsed={collapsed} />
        </button>
      </div>
      {PRIMARY.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>{t('navGroupRegistry')}</div>}
      {REGISTRY.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>{t('navGroupOracle')}</div>}
      {ORACLE.map((it) => (
        <Item key={it.to} item={it} collapsed={collapsed} />
      ))}
      {collapsed ? <div className={styles.divider} aria-hidden="true" /> : <div className={styles.group}>{t('navGroupRuns')}</div>}
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
          title={collapsed ? t('help') : undefined}
          aria-label={t('help')}
        >
          <span className={styles.icon}>
            <HelpCircle size={16} />
          </span>
          {collapsed ? null : <span className={styles.label}>{t('help')}</span>}
        </button>
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </nav>
  );
}
