// "Profile" — the signed-in Archon's own account, reached from the AID menu in the
// Topbar. Sub-nav is built from the SECTIONS array, as on Settings: a sibling
// ticket adds its section as one entry here (password — NIM-1051, sign-ins —
// NIM-1050) and its route comes with it.

import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { MyTokens } from './MyTokens';
import commonStyles from '../common.module.css';
import styles from '../settings/SettingsPage.module.css';

interface Section {
  /** slug path relative to /profile/ */
  path: string;
  /** i18n key for the tab title */
  labelKey: string;
  element: ReactNode;
}

const SECTIONS: Section[] = [
  { path: 'tokens', labelKey: 'profile:tabTokens', element: <MyTokens /> },
];

export function ProfilePage() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const location = useLocation();
  const activePath = location.pathname.replace(/^\/profile\/?/, '').split('/')[0];

  return (
    <div className={commonStyles.page}>
      <div className={commonStyles.header}>
        <div>
          <h1 className={commonStyles.title}>{t('profile:title')}</h1>
          <div className={`${commonStyles.crumbs} mono`}>{identity?.aid}</div>
        </div>
      </div>

      <nav className={styles.subNav} aria-label={t('profile:navAria')}>
        {SECTIONS.map((s) => (
          <NavLink
            key={s.path}
            to={`/profile/${s.path}`}
            className={activePath === s.path ? `${styles.subNavLink} ${styles.subNavLinkActive}` : styles.subNavLink}
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
          <Route path="*" element={<Navigate to={`/profile/${SECTIONS[0].path}`} replace />} />
        </Routes>
      </div>
    </div>
  );
}
