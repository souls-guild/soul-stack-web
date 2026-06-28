// Страница «Настройки» — keeper-side конфигурация.
// Sub-nav строится из массива SECTIONS: добавить новый раздел = одна запись.
// Текущие разделы:
//   provisioning-policy — методы создания операторов (ADR-058)
// Будущие: TLS-политики, Redis-топология, LDAP/OIDC-конфиги и т.п.

import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProvisioningPolicy } from '../archons/ProvisioningPolicy';
import { AppearanceSettings } from './AppearanceSettings';
import styles from './SettingsPage.module.css';
import commonStyles from '../common.module.css';

interface Section {
  /** slug-путь относительно /settings/ */
  path: string;
  /** i18n-ключ для заголовка вкладки */
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
  // Следующий раздел: { path: 'auth', labelKey: 'admin:settingsTabAuth', element: <AuthSettings /> },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const location = useLocation();

  // Определяем активную вкладку по текущему пути.
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
          {/* Дефолтный redirect на первый раздел */}
          <Route path="*" element={<Navigate to={`/settings/${SECTIONS[0].path}`} replace />} />
        </Routes>
      </div>
    </div>
  );
}
