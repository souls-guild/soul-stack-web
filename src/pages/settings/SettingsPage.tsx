// "Settings" page — keeper-side configuration.
// Sub-nav is built from the SECTIONS array: add a new section = one entry.
// Current sections:
//   provisioning-policy — operator creation methods (ADR-058)
// Future: TLS policies, Redis topology, LDAP/OIDC configs, etc.

import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProvisioningPolicy } from '../archons/ProvisioningPolicy';
import { AppearanceSettings } from './AppearanceSettings';
import styles from './SettingsPage.module.css';
import commonStyles from '../common.module.css';

interface Section {
  /** slug path relative to /settings/ */
  path: string;
  /** i18n key for the tab title */
  labelKey: string;
  element: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    path: 'appearance',
    labelKey: 'admin:settingsTabAppearance',
    element: <AppearanceSettings />,
  },
  {
    path: 'provisioning-policy',
    labelKey: 'admin:settingsTabProvPolicy',
    element: <ProvisioningPolicy />,
  },
  // Next section: { path: 'auth', labelKey: 'admin:settingsTabAuth', element: <AuthSettings /> },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const location = useLocation();

  // Determine the active tab from the current path.
  const activePath = location.pathname.replace(/^\/settings\/?/, '').split('/')[0];

  return (
    <div className={commonStyles.page}>
      <div className={commonStyles.header}>
        <div>
          <h1 className={commonStyles.title}>{t('admin:settingsTitle')}</h1>
          <div className={commonStyles.crumbs}>{t('admin:settingsCrumbs')}</div>
        </div>
      </div>

      <nav className={styles.subNav} aria-label={t('admin:settingsNavAria')}>
        {SECTIONS.map((s) => (
          <NavLink
            key={s.path}
            to={`/settings/${s.path}`}
            className={activePath === s.path
              ? `${styles.subNavLink} ${styles.subNavLinkActive}`
              : styles.subNavLink}
          >
            {t(s.labelKey)}
          </NavLink>
        ))}
      </nav>

      <div className={styles.content}>
        <Routes>
          {SECTIONS.map((s) => (
            <Route key={s.path} path={s.path} element={s.element} />
          ))}
          {/* Default redirect to the first section */}
          <Route path="*" element={<Navigate to={`/settings/${SECTIONS[0].path}`} replace />} />
        </Routes>
      </div>
    </div>
  );
}
