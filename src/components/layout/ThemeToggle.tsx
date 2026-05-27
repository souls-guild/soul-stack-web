import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../hooks/useTheme';
import styles from './ThemeToggle.module.css';

const ORDER: ThemeMode[] = ['light', 'dark', 'system'];

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const TITLES: Record<ThemeMode, string> = {
  light: 'Светлая тема',
  dark: 'Тёмная тема',
  system: 'Системная тема',
};

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className={styles.group} role="group" aria-label="Тема оформления">
      {ORDER.map((m) => {
        const Icon = ICONS[m];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            className={active ? `${styles.btn} ${styles.btnActive}` : styles.btn}
            aria-pressed={active}
            aria-label={TITLES[m]}
            title={TITLES[m]}
            onClick={() => setMode(m)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
