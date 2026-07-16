// Settings / Appearance tab — theme, font, and language selection.
// Theme: useTheme() from ThemeProvider (context), displays all THEME_MODES.
// Font: useFont() from FontProvider — independent selector (see useFont.ts), not tied to theme.
// Language: LangToggle / changeLang from i18n (react-i18next persisted via localStorage).

import { useTheme, THEME_MODES, type ThemeMode } from '../../hooks/useTheme';
import { useFont, FONT_MODES, FONT_STACKS, type FontMode } from '../../hooks/useFont';
import { useTranslation } from 'react-i18next';
import { changeLang, SUPPORTED_LANGS, type Lang } from '../../i18n';
import { Sun, Moon, Monitor, Flame, Layers, Type, Terminal, BookOpen, Sparkles, Squircle, Shapes, Feather, Wand2, Smile } from 'lucide-react';
import { useState } from 'react';
import styles from './AppearanceSettings.module.css';

const THEME_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
  warm: Flame,
  deep: Layers,
};

const THEME_TITLE_KEYS: Record<ThemeMode, string> = {
  light: 'admin:themeLight',
  dark: 'admin:themeDark',
  system: 'admin:themeSystem',
  warm: 'admin:themeWarm',
  deep: 'admin:themeDeep',
};

const THEME_DESC_KEYS: Record<ThemeMode, string> = {
  light: 'admin:themeLightDesc',
  dark: 'admin:themeDarkDesc',
  system: 'admin:themeSystemDesc',
  warm: 'admin:themeWarmDesc',
  deep: 'admin:themeDeepDesc',
};

const FONT_ICONS: Record<FontMode, typeof Type> = {
  system: Type,
  mono: Terminal,
  serif: BookOpen,
  manrope: Sparkles,
  quicksand: Squircle,
  unbounded: Shapes,
  caveat: Feather,
  comfortaa: Wand2,
  'comic-neue': Smile,
};

const FONT_TITLE_KEYS: Record<FontMode, string> = {
  system: 'admin:fontSystem',
  mono: 'admin:fontMono',
  serif: 'admin:fontSerif',
  manrope: 'admin:fontManrope',
  quicksand: 'admin:fontQuicksand',
  unbounded: 'admin:fontUnbounded',
  caveat: 'admin:fontCaveat',
  comfortaa: 'admin:fontComfortaa',
  'comic-neue': 'admin:fontComicNeue',
};

const FONT_DESC_KEYS: Record<FontMode, string> = {
  system: 'admin:fontSystemDesc',
  mono: 'admin:fontMonoDesc',
  serif: 'admin:fontSerifDesc',
  manrope: 'admin:fontManropeDesc',
  quicksand: 'admin:fontQuicksandDesc',
  unbounded: 'admin:fontUnboundedDesc',
  caveat: 'admin:fontCaveatDesc',
  comfortaa: 'admin:fontComfortaaDesc',
  'comic-neue': 'admin:fontComicNeueDesc',
};

const LANG_LABELS: Record<Lang, string> = {
  ru: 'Русский',
  en: 'English',
};

export function AppearanceSettings() {
  const { t, i18n } = useTranslation();
  const { mode, setMode } = useTheme();
  const { font, setFont } = useFont();
  const currentLang = (i18n.resolvedLanguage ?? i18n.language) as Lang;
  const [langLoading, setLangLoading] = useState(false);

  const onLangSwitch = (lng: Lang) => {
    if (lng === currentLang || langLoading) return;
    setLangLoading(true);
    void changeLang(lng).finally(() => setLangLoading(false));
  };

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('admin:appearanceThemeTitle')}</h2>
        <p className={styles.sectionDesc}>{t('admin:appearanceThemeDesc')}</p>
        <div className={styles.themeGrid} role="group" aria-label={t('admin:themeAriaGroup')}>
          {THEME_MODES.map((m) => {
            const Icon = THEME_ICONS[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                className={active ? `${styles.themeCard} ${styles.themeCardActive}` : styles.themeCard}
                aria-pressed={active}
                data-testid={`appearance-theme-${m}`}
                onClick={() => setMode(m)}
              >
                <span className={styles.themeIcon}>
                  <Icon size={20} />
                </span>
                <span className={styles.themeLabel}>{t(THEME_TITLE_KEYS[m])}</span>
                <span className={styles.themeDesc}>{t(THEME_DESC_KEYS[m])}</span>
                {active && <span className={styles.themeCheck} aria-hidden="true">&#10003;</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('admin:appearanceFontTitle')}</h2>
        <p className={styles.sectionDesc}>{t('admin:appearanceFontDesc')}</p>
        <div className={styles.themeGrid} role="group" aria-label={t('admin:fontAriaGroup')}>
          {FONT_MODES.map((f) => {
            const Icon = FONT_ICONS[f];
            const active = font === f;
            return (
              <button
                key={f}
                type="button"
                className={active ? `${styles.themeCard} ${styles.themeCardActive}` : styles.themeCard}
                aria-pressed={active}
                data-testid={`appearance-font-${f}`}
                style={{ fontFamily: FONT_STACKS[f] }}
                onClick={() => setFont(f)}
              >
                <span className={styles.themeIcon}>
                  <Icon size={20} />
                </span>
                <span className={styles.themeLabel}>{t(FONT_TITLE_KEYS[f])}</span>
                <span className={styles.themeDesc}>{t(FONT_DESC_KEYS[f])}</span>
                {active && <span className={styles.themeCheck} aria-hidden="true">&#10003;</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('admin:appearanceLangTitle')}</h2>
        <p className={styles.sectionDesc}>{t('admin:appearanceLangDesc')}</p>
        <div className={styles.langGrid} role="group" aria-label={t('admin:langAriaGroup')}>
          {SUPPORTED_LANGS.map((lng) => {
            const active = currentLang === lng;
            return (
              <button
                key={lng}
                type="button"
                className={active ? `${styles.langCard} ${styles.langCardActive}` : styles.langCard}
                aria-pressed={active}
                disabled={langLoading}
                data-testid={`appearance-lang-${lng}`}
                onClick={() => onLangSwitch(lng)}
              >
                <span className={styles.langCode}>{lng.toUpperCase()}</span>
                <span className={styles.langLabel}>{LANG_LABELS[lng]}</span>
                {active && <span className={styles.themeCheck} aria-hidden="true">&#10003;</span>}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
