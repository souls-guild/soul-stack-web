import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import en from './locales/en.json';

// i18n Soul Stack UI.
// Языки: ru (default + fallback) / en. Выбор хранится в localStorage('lang').
// Имена сущностей (Archon / Keeper / Souls / Coven / Tide / …) НЕ переводятся —
// они либо хардкод English в JSX, либо identical в обоих locale.

export const SUPPORTED_LANGS = ['ru', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'ru';
export const LANG_STORAGE_KEY = 'lang';

function detectLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // localStorage недоступен (private mode / quota) — fallback на default.
  }
  return DEFAULT_LANG;
}

i18n.use(initReactI18next).init({
  resources: {
    ru: ru as Record<string, object>,
    en: en as Record<string, object>,
  },
  lng: detectLang(),
  fallbackLng: DEFAULT_LANG,
  ns: ['common', 'forms', 'errors', 'pages'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false, // React сам экранирует.
  },
  returnNull: false,
});

export function changeLang(lng: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  void i18n.changeLanguage(lng);
}

export default i18n;
