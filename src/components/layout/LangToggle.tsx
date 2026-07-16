import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLang, SUPPORTED_LANGS, type Lang } from '../../i18n';
import styles from './ThemeToggle.module.css';

const LABELS: Record<Lang, string> = {
  ru: 'RU',
  en: 'EN',
};

export function LangToggle() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language) as Lang;
  // Non-default languages load over HTTP async - disable buttons while loading
  // to avoid a double click / a race between switches.
  const [loading, setLoading] = useState(false);

  const onSwitch = (lng: Lang) => {
    if (lng === current || loading) return;
    setLoading(true);
    void changeLang(lng).finally(() => setLoading(false));
  };

  return (
    <div className={styles.group} role="group" aria-label="Language">
      {SUPPORTED_LANGS.map((lng) => {
        const active = current === lng;
        return (
          <button
            key={lng}
            type="button"
            className={active ? `${styles.btn} ${styles.btnActive}` : styles.btn}
            aria-pressed={active}
            aria-label={LABELS[lng]}
            title={LABELS[lng]}
            disabled={loading}
            onClick={() => onSwitch(lng)}
            data-testid={`lang-${lng}`}
          >
            {LABELS[lng]}
          </button>
        );
      })}
    </div>
  );
}
