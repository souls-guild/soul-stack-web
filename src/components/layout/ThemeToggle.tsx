import { Sun, Moon, Monitor, Flame, Layers } from 'lucide-react';
import { useTheme, THEME_MODES, type ThemeMode } from '../../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import styles from './ThemeToggle.module.css';

const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
  warm: Flame,
  deep: Layers,
};

const TITLE_KEYS: Record<ThemeMode, string> = {
  light: 'admin:themeLight',
  dark: 'admin:themeDark',
  system: 'admin:themeSystem',
  warm: 'admin:themeWarm',
  deep: 'admin:themeDeep',
};

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const { t } = useTranslation();

  return (
    <div className={styles.group} role="group" aria-label={t('admin:themeAriaGroup')}>
      {THEME_MODES.map((m) => {
        const Icon = ICONS[m];
        const active = mode === m;
        const title = t(TITLE_KEYS[m]);
        return (
          <button
            key={m}
            type="button"
            className={active ? `${styles.btn} ${styles.btnActive}` : styles.btn}
            aria-pressed={active}
            aria-label={title}
            title={title}
            data-testid={`theme-${m}`}
            onClick={() => setMode(m)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
