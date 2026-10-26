// "Profile" — the signed-in Archon's own account, reached from the AID menu in the
// Topbar. Sub-nav and routes are built from the sections this Archon has, as on
// Settings: each section is a Section constant in the list (password only for
// a local Archon).

import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { MyTokens } from './MyTokens';
import { MyPassword } from './MyPassword';
import { MySessions } from './MySessions';
import { MyOwnedArchons } from './MyOwnedArchons';
import { useIsLocalArchon } from './useIsLocalArchon';
import commonStyles from '../common.module.css';
import styles from '../settings/SettingsPage.module.css';
import own from './ProfilePage.module.css';

interface Section {
  /** slug path relative to /profile/ */
  path: string;
  /** i18n key for the tab title */
  labelKey: string;
  element: ReactNode;
}

const TOKENS: Section = { path: 'tokens', labelKey: 'profile:tabTokens', element: <MyTokens /> };
const SESSIONS: Section = { path: 'sessions', labelKey: 'profile:tabSessions', element: <MySessions /> };
const OWNED: Section = { path: 'owned', labelKey: 'profile:tabOwned', element: <MyOwnedArchons /> };
// Only a local Archon has a password here to change (NIM-1051).
const PASSWORD: Section = { path: 'password', labelKey: 'profile:tabPassword', element: <MyPassword /> };

export function ProfilePage() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const location = useLocation();
  const activePath = location.pathname.replace(/^\/profile\/?/, '').split('/')[0];
  const local = useIsLocalArchon();
  const SECTIONS: Section[] = local ? [TOKENS, SESSIONS, OWNED, PASSWORD] : [TOKENS, SESSIONS, OWNED];

  return (
    <div className={`${commonStyles.page} ${own.profile}`}>
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
          {/* A link straight to Password waits for the operator record rather than bouncing to Tokens. */}
          <Route
            path="*"
            element={
              local === undefined && activePath === PASSWORD.path ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="profile-section-loading">{t('loading')}</div>
              ) : (
                <Navigate to={`/profile/${SECTIONS[0].path}`} replace />
              )
            }
          />
        </Routes>
      </div>
    </div>
  );
}
